import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  { ignores: ['dist/', '.astro/', '.netlify/', 'node_modules/', 'public/'] },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      // XSS: los textos de usuario siempre como texto. Prohibido v-html (ver también tests/security.test.ts).
      'vue/no-v-html': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Prohibido: usa texto, no HTML (XSS).' },
        { property: 'outerHTML', message: 'Prohibido: usa texto, no HTML (XSS).' },
        { property: 'insertAdjacentHTML', message: 'Prohibido: usa texto, no HTML (XSS).' },
      ],
      'no-eval': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Reglas de formato de Vue que chocan con el estilo del proyecto.
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
    },
  },
);
