import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { products, productChannelMappings, syncEvents, alerts } from '../db/schema.js';
import {
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  createMappingSchema,
  paginationSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type UpdateStockInput,
  type CreateMappingInput,
  type ApiResponse,
  type PaginatedResponse,
  type Product,
  type ProductWithMappings,
} from '../types/index.js';
import { authenticateRequest, getTenantId } from '../middleware/auth.js';

export async function productRoutes(app: FastifyInstance): Promise<void> {
  // All routes require authentication
  app.addHook('preHandler', authenticateRequest);

  // GET /products - List all products for tenant with pagination
  app.get<{ Querystring: { page?: string; limit?: string; search?: string } }>(
    '/',
    async (
      request: FastifyRequest<{ Querystring: { page?: string; limit?: string; search?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const pagination = paginationSchema.parse(request.query);
        const { page, limit } = pagination;
        const offset = (page - 1) * limit;

        // Get total count
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(eq(products.tenantId, tenantId));

        // Get paginated products with channel mappings
        const tenantProducts = await db.query.products.findMany({
          where: eq(products.tenantId, tenantId),
          with: {
            channelMappings: {
              with: {
                channel: {
                  columns: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            },
          },
          orderBy: [desc(products.updatedAt)],
          limit,
          offset,
        });

        return reply.code(200).send({
          success: true,
          data: tenantProducts,
          pagination: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
          },
        } satisfies PaginatedResponse<ProductWithMappings>);
      } catch (error) {
        console.error('List products error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch products',
        } satisfies ApiResponse);
      }
    }
  );

  // GET /products/:id - Get single product with mappings
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const product = await db.query.products.findFirst({
          where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
          with: {
            channelMappings: {
              with: {
                channel: {
                  columns: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            },
          },
        });

        if (!product) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          data: product,
        } satisfies ApiResponse<ProductWithMappings>);
      } catch (error) {
        console.error('Get product error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to fetch product',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /products - Create new product
  app.post<{ Body: CreateProductInput }>(
    '/',
    async (request: FastifyRequest<{ Body: CreateProductInput }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);

        const validation = createProductSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { sku, name, currentStock, bufferStock, metadata } = validation.data;

        // Check for duplicate SKU within tenant
        const existingProduct = await db.query.products.findFirst({
          where: and(eq(products.tenantId, tenantId), eq(products.sku, sku)),
        });

        if (existingProduct) {
          return reply.code(409).send({
            success: false,
            error: 'Conflict',
            message: 'A product with this SKU already exists',
          } satisfies ApiResponse);
        }

        const [newProduct] = await db
          .insert(products)
          .values({
            tenantId,
            sku,
            name,
            currentStock: currentStock ?? 0,
            bufferStock: bufferStock ?? 0,
            metadata,
          })
          .returning();

        return reply.code(201).send({
          success: true,
          data: newProduct,
          message: 'Product created successfully',
        } satisfies ApiResponse<Product>);
      } catch (error) {
        console.error('Create product error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create product',
        } satisfies ApiResponse);
      }
    }
  );

  // PATCH /products/:id - Update product
  app.patch<{ Params: { id: string }; Body: UpdateProductInput }>(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateProductInput }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const validation = updateProductSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        // Check if product exists
        const existingProduct = await db.query.products.findFirst({
          where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
        });

        if (!existingProduct) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        // Check for SKU conflict if SKU is being updated
        if (validation.data.sku && validation.data.sku !== existingProduct.sku) {
          const skuConflict = await db.query.products.findFirst({
            where: and(eq(products.tenantId, tenantId), eq(products.sku, validation.data.sku)),
          });

          if (skuConflict) {
            return reply.code(409).send({
              success: false,
              error: 'Conflict',
              message: 'A product with this SKU already exists',
            } satisfies ApiResponse);
          }
        }

        const [updatedProduct] = await db
          .update(products)
          .set({
            ...validation.data,
            updatedAt: new Date(),
          })
          .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
          .returning();

        return reply.code(200).send({
          success: true,
          data: updatedProduct,
          message: 'Product updated successfully',
        } satisfies ApiResponse<Product>);
      } catch (error) {
        console.error('Update product error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update product',
        } satisfies ApiResponse);
      }
    }
  );

  // PUT /products/:id/stock - Update stock level (creates sync event)
  app.put<{ Params: { id: string }; Body: UpdateStockInput }>(
    '/:id/stock',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateStockInput }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const validation = updateStockSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { currentStock, reason } = validation.data;

        // Get existing product
        const existingProduct = await db.query.products.findFirst({
          where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
        });

        if (!existingProduct) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        const oldStock = existingProduct.currentStock;

        // Update stock and create sync event in transaction
        const result = await db.transaction(async (tx) => {
          // Update product stock
          const [updatedProduct] = await tx
            .update(products)
            .set({
              currentStock,
              updatedAt: new Date(),
            })
            .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
            .returning();

          // Create sync event for audit
          const [syncEvent] = await tx
            .insert(syncEvents)
            .values({
              tenantId,
              eventType: 'stock_update',
              productId: id,
              oldValue: { stock: oldStock },
              newValue: { stock: currentStock, reason },
              status: 'completed',
            })
            .returning();

          // Check if stock is low and create alert if needed
          if (currentStock <= updatedProduct.bufferStock) {
            await tx.insert(alerts).values({
              tenantId,
              type: 'low_stock',
              message: `Low stock alert: ${updatedProduct.name} (${updatedProduct.sku}) is at ${currentStock} units (buffer: ${updatedProduct.bufferStock})`,
              metadata: {
                productId: id,
                sku: updatedProduct.sku,
                currentStock,
                bufferStock: updatedProduct.bufferStock,
              },
            });
          }

          return { product: updatedProduct, syncEvent };
        });

        return reply.code(200).send({
          success: true,
          data: {
            product: result.product,
            stockChange: {
              oldStock,
              newStock: currentStock,
              delta: currentStock - oldStock,
            },
          },
          message: 'Stock updated successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Update stock error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to update stock',
        } satisfies ApiResponse);
      }
    }
  );

  // DELETE /products/:id - Delete product
  app.delete<{ Params: { id: string } }>(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params;

        const deleted = await db
          .delete(products)
          .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
          .returning();

        if (deleted.length === 0) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          message: 'Product deleted successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Delete product error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to delete product',
        } satisfies ApiResponse);
      }
    }
  );

  // POST /products/:id/mappings - Add channel mapping to product
  app.post<{ Params: { id: string }; Body: Omit<CreateMappingInput, 'productId'> }>(
    '/:id/mappings',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: Omit<CreateMappingInput, 'productId'> }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id: productId } = request.params;

        const validation = createMappingSchema.safeParse({
          ...request.body,
          productId,
        });

        if (!validation.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            message: validation.error.issues.map((i) => i.message).join(', '),
          } satisfies ApiResponse);
        }

        const { channelId, externalId, externalSku } = validation.data;

        // Verify product belongs to tenant
        const product = await db.query.products.findFirst({
          where: and(eq(products.id, productId), eq(products.tenantId, tenantId)),
        });

        if (!product) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        // Check for existing mapping
        const existingMapping = await db.query.productChannelMappings.findFirst({
          where: and(
            eq(productChannelMappings.productId, productId),
            eq(productChannelMappings.channelId, channelId)
          ),
        });

        if (existingMapping) {
          return reply.code(409).send({
            success: false,
            error: 'Conflict',
            message: 'This product is already mapped to this channel',
          } satisfies ApiResponse);
        }

        const [newMapping] = await db
          .insert(productChannelMappings)
          .values({
            productId,
            channelId,
            externalId,
            externalSku,
          })
          .returning();

        return reply.code(201).send({
          success: true,
          data: newMapping,
          message: 'Channel mapping created successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Create mapping error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to create channel mapping',
        } satisfies ApiResponse);
      }
    }
  );

  // DELETE /products/:id/mappings/:mappingId - Remove channel mapping
  app.delete<{ Params: { id: string; mappingId: string } }>(
    '/:id/mappings/:mappingId',
    async (
      request: FastifyRequest<{ Params: { id: string; mappingId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = getTenantId(request);
        const { id: productId, mappingId } = request.params;

        // Verify product belongs to tenant
        const product = await db.query.products.findFirst({
          where: and(eq(products.id, productId), eq(products.tenantId, tenantId)),
        });

        if (!product) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Product not found',
          } satisfies ApiResponse);
        }

        const deleted = await db
          .delete(productChannelMappings)
          .where(
            and(
              eq(productChannelMappings.id, mappingId),
              eq(productChannelMappings.productId, productId)
            )
          )
          .returning();

        if (deleted.length === 0) {
          return reply.code(404).send({
            success: false,
            error: 'Not found',
            message: 'Mapping not found',
          } satisfies ApiResponse);
        }

        return reply.code(200).send({
          success: true,
          message: 'Channel mapping deleted successfully',
        } satisfies ApiResponse);
      } catch (error) {
        console.error('Delete mapping error:', error);
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          message: 'Failed to delete channel mapping',
        } satisfies ApiResponse);
      }
    }
  );
}

export default productRoutes;
