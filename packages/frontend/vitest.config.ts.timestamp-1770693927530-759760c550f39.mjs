// packages/frontend/vitest.config.ts
import { defineConfig } from "file:///sessions/tender-bold-feynman/mnt/stockclerk-temp/node_modules/vitest/dist/config.js";
import react from "file:///sessions/tender-bold-feynman/mnt/stockclerk-temp/node_modules/@vitejs/plugin-react/dist/index.js";
var vitest_config_default = defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "build", "src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/__tests__/**",
        "src/types/**",
        "node_modules/**"
      ]
    },
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 1e4
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsicGFja2FnZXMvZnJvbnRlbmQvdml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9zZXNzaW9ucy90ZW5kZXItYm9sZC1mZXlubWFuL21udC9zdG9ja2NsZXJrLXRlbXAvcGFja2FnZXMvZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9zZXNzaW9ucy90ZW5kZXItYm9sZC1mZXlubWFuL21udC9zdG9ja2NsZXJrLXRlbXAvcGFja2FnZXMvZnJvbnRlbmQvdml0ZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vc2Vzc2lvbnMvdGVuZGVyLWJvbGQtZmV5bm1hbi9tbnQvc3RvY2tjbGVyay10ZW1wL3BhY2thZ2VzL2Zyb250ZW5kL3ZpdGVzdC5jb25maWcudHNcIjsvKipcbiAqIFZpdGVzdCBDb25maWd1cmF0aW9uIC0gRnJvbnRlbmQgUGFja2FnZVxuICovXG5cbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGVzdC9jb25maWcnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICB0ZXN0OiB7XG4gICAgZ2xvYmFsczogdHJ1ZSxcbiAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcbiAgICBpbmNsdWRlOiBbJ3NyYy8qKi8qLnRlc3QudHMnLCAnc3JjLyoqLyoudGVzdC50c3gnXSxcbiAgICBleGNsdWRlOiBbJ25vZGVfbW9kdWxlcycsICdkaXN0JywgJ2J1aWxkJywgJ3NyYy9fX3Rlc3RzX18vc2V0dXAudHMnXSxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6ICd2OCcsXG4gICAgICByZXBvcnRlcjogWyd0ZXh0JywgJ2pzb24nLCAnaHRtbCddLFxuICAgICAgcmVwb3J0c0RpcmVjdG9yeTogJy4vY292ZXJhZ2UnLFxuICAgICAgaW5jbHVkZTogWydzcmMvKiovKi50cycsICdzcmMvKiovKi50c3gnXSxcbiAgICAgIGV4Y2x1ZGU6IFtcbiAgICAgICAgJ3NyYy8qKi8qLnRlc3QudHMnLFxuICAgICAgICAnc3JjLyoqLyoudGVzdC50c3gnLFxuICAgICAgICAnc3JjL19fdGVzdHNfXy8qKicsXG4gICAgICAgICdzcmMvdHlwZXMvKionLFxuICAgICAgICAnbm9kZV9tb2R1bGVzLyoqJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBzZXR1cEZpbGVzOiBbJy4vc3JjL19fdGVzdHNfXy9zZXR1cC50cyddLFxuICAgIHRlc3RUaW1lb3V0OiAxMDAwMCxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUlBLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sV0FBVztBQUVsQixJQUFPLHdCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsTUFBTTtBQUFBLElBQ0osU0FBUztBQUFBLElBQ1QsYUFBYTtBQUFBLElBQ2IsU0FBUyxDQUFDLG9CQUFvQixtQkFBbUI7QUFBQSxJQUNqRCxTQUFTLENBQUMsZ0JBQWdCLFFBQVEsU0FBUyx3QkFBd0I7QUFBQSxJQUNuRSxVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixVQUFVLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxNQUNqQyxrQkFBa0I7QUFBQSxNQUNsQixTQUFTLENBQUMsZUFBZSxjQUFjO0FBQUEsTUFDdkMsU0FBUztBQUFBLFFBQ1A7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLFlBQVksQ0FBQywwQkFBMEI7QUFBQSxJQUN2QyxhQUFhO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
