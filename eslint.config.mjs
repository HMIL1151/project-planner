import { defineConfig } from "eslint/config";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
    js.configs.recommended,
    {
        files: ['**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}'],
        plugins: {
            "@eslint-react": eslintReact,
            "react-hooks": reactHooks,
            "@typescript-eslint": tseslint,
        },
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.serviceworker,
                ...globals.browser,
                // Obsidian's ambient globals. The `create*` helpers are what
                // obsidianmd/prefer-create-el points you at, so they have to be
                // declared here or using them is a no-undef error.
                activeDocument: "readonly",
                activeWindow: "readonly",
                createEl: "readonly",
                createDiv: "readonly",
                createSpan: "readonly",
                createFragment: "readonly",
                createSvg: "readonly",
            },
        },
        rules: {
            ...prettierConfig.rules,
            ...eslintReact.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            "react-hooks/set-state-in-effect": "warn",
            "@typescript-eslint/no-explicit-any": "error",
            "no-unused-vars": ["error", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_"
            }],
            "no-restricted-syntax": ["error",
                {
                    "selector": "CallExpression[callee.property.name='createElement'][arguments.0.value='style']",
                    "message": "Do not create <style> elements dynamically. Use styles.css instead, which Obsidian loads automatically."
                },
                {
                    "selector": "JSXAttribute[name.name='style']",
                    "message": "Inline styles are not allowed. Use CSS classes in global.css instead."
                }
            ],
        },
    },
    // Type-aware rules, which need a TypeScript program and so cost real time
    // to run. `no-explicit-any` above catches the `any` we write ourselves;
    // these catch the `any` that leaks in from libraries whose signatures are
    // untyped — ReactFlow's edge `data`, `parseYaml`'s return — and which is
    // invisible without types. Obsidian's plugin review runs them, so we run
    // them too rather than hear about it second-hand.
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "@typescript-eslint/no-misused-promises": "error",
        },
    }
]);
