import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Command IDs are public compatibility keys; renaming them would erase
      // existing user hotkey assignments.
      "obsidianmd/commands/no-plugin-id-in-command-id": "off",
      // These literals are code samples and URLs, not prose labels.
      "obsidianmd/ui/sentence-case": "off",
      // The control-character range sanitizes imported text intentionally.
      "no-control-regex": "off",
      // Exhaustive switches intentionally interpolate a `never` value in errors.
      "@typescript-eslint/restrict-template-expressions": "off",
      // execCommand is retained as a fallback because it preserves the textarea
      // undo stack on older Electron builds.
      "@typescript-eslint/no-deprecated": "off",
      // The destructive normalize command deliberately uses a native blocking
      // confirmation before touching every memo file.
      "no-alert": "off",
      // DOM event targets intentionally ignore callback return values. Keep these
      // visible during review without making safe browser handlers block release.
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      // External browser/Obsidian payloads are narrowed incrementally at runtime.
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
    },
  },
]);
