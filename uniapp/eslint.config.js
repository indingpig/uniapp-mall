import uniHelper from '@uni-helper/eslint-config';

export default uniHelper({
  // 设计稿目录（disign/）是文档与设计交付物，其中的代码块不参与 lint
  ignores: ['disign/**'],
  stylistic: {
    'semi': true,
    'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
  },
});
