// vitest.config.ts
import { defineConfig } from "file:///sessions/tender-bold-feynman/mnt/stockclerk-temp/node_modules/vitest/dist/config.js";
var vitest_config_default = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/types/**",
        "node_modules/**"
      ]
    },
    testTimeout: 3e4,
    hookTimeout: 3e4
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9zZXNzaW9ucy90ZW5kZXItYm9sZC1mZXlubWFuL21udC9zdG9ja2NsZXJrLXRlbXAvcGFja2FnZXMvc3luYy1lbmdpbmVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy90ZW5kZXItYm9sZC1mZXlubWFuL21udC9zdG9ja2NsZXJrLXRlbXAvcGFja2FnZXMvc3luYy1lbmdpbmUvdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvdGVuZGVyLWJvbGQtZmV5bm1hbi9tbnQvc3RvY2tjbGVyay10ZW1wL3BhY2thZ2VzL3N5bmMtZW5naW5lL3ZpdGVzdC5jb25maWcudHNcIjsvKipcbiAqIFZpdGVzdCBDb25maWd1cmF0aW9uIC0gU3luYyBFbmdpbmUgUGFja2FnZVxuICovXG5cbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICB0ZXN0OiB7XG4gICAgZ2xvYmFsczogdHJ1ZSxcbiAgICBlbnZpcm9ubWVudDogJ25vZGUnLFxuICAgIGluY2x1ZGU6IFsnc3JjLyoqLyoudGVzdC50cyddLFxuICAgIGV4Y2x1ZGU6IFsnbm9kZV9tb2R1bGVzJywgJ2Rpc3QnLCAnc3JjL19fdGVzdHNfXy9zZXR1cC50cyddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIHJlcG9ydGVyOiBbJ3RleHQnLCAnanNvbicsICdodG1sJ10sXG4gICAgICByZXBvcnRzRGlyZWN0b3J5OiAnLi9jb3ZlcmFnZScsXG4gICAgICBpbmNsdWRlOiBbJ3NyYy8qKi8qLnRzJ10sXG4gICAgICBleGNsdWRlOiBbXG4gICAgICAgICdzcmMvKiovKi50ZXN0LnRzJyxcbiAgICAgICAgJ3NyYy9fX3Rlc3RzX18vKionLFxuICAgICAgICAnc3JjL3R5cGVzLyoqJyxcbiAgICAgICAgJ25vZGVfbW9kdWxlcy8qKicsXG4gICAgICBdLFxuICAgIH0sXG4gICAgdGVzdFRpbWVvdXQ6IDMwMDAwLFxuICAgIGhvb2tUaW1lb3V0OiAzMDAwMCxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUlBLFNBQVMsb0JBQW9CO0FBRTdCLElBQU8sd0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxJQUNKLFNBQVM7QUFBQSxJQUNULGFBQWE7QUFBQSxJQUNiLFNBQVMsQ0FBQyxrQkFBa0I7QUFBQSxJQUM1QixTQUFTLENBQUMsZ0JBQWdCLFFBQVEsd0JBQXdCO0FBQUEsSUFDMUQsVUFBVTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxDQUFDLFFBQVEsUUFBUSxNQUFNO0FBQUEsTUFDakMsa0JBQWtCO0FBQUEsTUFDbEIsU0FBUyxDQUFDLGFBQWE7QUFBQSxNQUN2QixTQUFTO0FBQUEsUUFDUDtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxhQUFhO0FBQUEsSUFDYixhQUFhO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
