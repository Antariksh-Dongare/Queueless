import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [js.configs.recommended, ...tseslint.configs.recommended, { ignores: ["dist", "generated"] }, { rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-namespace": "off" } }];
