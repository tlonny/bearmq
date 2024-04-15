import parser from "@typescript-eslint/parser"
import stylisticPlugin from "@stylistic/eslint-plugin-ts"
import typescriptPlugin from "@typescript-eslint/eslint-plugin"

export default {
  files: ["**/*.ts"],
  ignores: ["build/*.ts"],
  plugins: {
    "@typescript-eslint": typescriptPlugin,
    "@stylistic/ts": stylisticPlugin,
  },
  languageOptions: { parser },
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "eol-last": ["warn", "always"],
    "semi": ["warn", "never"],
    "indent": ["warn", 4],
    "quotes": ["warn", "double"],
  }
}
