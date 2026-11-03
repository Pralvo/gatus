import dzrv from 'eslint-config-dzrv'

// eslint-config-dzrv's default export is its configs object, despite its README.

export default [
  ...dzrv['recommended-react-typescript'],
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
