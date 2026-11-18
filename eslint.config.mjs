// ESLint — конфигурация для проекта M62.
//
// ДВЕ СРЕДЫ, РАЗНЫЕ ПРАВИЛА:
//
//   1. Браузер (web/, src/transport-core.js, adapter-webhid.js,
//      доменные модули) — здесь НЕЛЬЗЯ node-глобалы. Если они
//      просочатся, страница упадёт у пользователя, а не в тесте.
//
//   2. Node (src/server.js, src/transport.js, src/tools/) — здесь
//      node-глобалы разрешены, браузерных нельзя.
//
// Запуск: npm run lint

import js from '@eslint/js';

/** Общие правила для всего проекта. */
const base = {
  ...js.configs.recommended,
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
  },
  rules: {
    ...js.configs.recommended.rules,

    // Неиспользуемые переменные — ошибка, но с оговорками:
    // аргументы, начинающиеся с _, разрешены (часто нужны для
    // совместимости сигнатур).
    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],

    // Отладка не должна попадать в код.
    'no-console': 'off', // для CLI-скриптов это нормально

    // Сравнения и присваивания — типичные источники багов.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',

    // Пустые блоки допустимы только с комментарием.
    'no-empty': ['error', { allowEmptyCatch: true }],

    // Возврат в finally ломает обработку ошибок.
    'no-unsafe-finally': 'error',

    // Регулярки без флага u ломаются на юникоде.
    'require-unicode-regexp': 'off', // слишком строго для нас

    // Недостижимый код.
    'no-unreachable': 'error',

    // Дублирование ключей в объектах.
    'no-dupe-keys': 'error',

    // Совпадение параметров функции.
    'no-dupe-args': 'error',
  },
};

export default [
  // Глобальные игнорируемые пути.
  {
    ignores: [
      'node_modules/**',
      'research/**',
      '_reviews/**',
      '**/*.min.js',
    ],
  },

  // ─── Среда 1: БРАУЗЕР ───
  // Эти файлы исполняются в браузере. Node-глобалы здесь запрещены.
  {
    ...base,
    files: [
      'web/**/*.js',
      'src/transport-core.js',
      'src/adapter-webhid.js',
      'src/transport-consts.js',
      'src/protocol.js',
      'src/crc16.js',
      'src/eq-hid.js',
      'src/eq-hp.js',
      'src/comp-hid.js',
      'src/reverb-hid.js',
      'src/phantom-hid.js',
      'src/mixer-tags.js',
      'src/mutes-loopback.js',
      'src/gain-scales.js',
    ],
    languageOptions: {
      ...base.languageOptions,
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Uint8Array: 'readonly',
        DataView: 'readonly',
        ArrayBuffer: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        Error: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Boolean: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        Infinity: 'readonly',
        isNaN: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      ...base.rules,
      // В браузере нет Buffer и process — ловим протечки.
      'no-restricted-globals': ['error',
        { name: 'require', message: 'браузерный модуль не может использовать require' },
        { name: 'process', message: 'браузерный модуль не может использовать process' },
        { name: 'Buffer', message: 'браузерный модуль не может использовать Buffer' },
        { name: '__dirname', message: 'браузерный модуль не может использовать __dirname' },
      ],
    },
  },

  // ─── Среда 2: NODE ───
  // Сервер, транспорт, инструменты.
  {
    ...base,
    files: [
      'src/server.js',
      'src/static-server.js',
      'src/transport.js',
      'src/adapter-nodehid.js',
      'src/tools/**/*.js',
      '**/*.mjs',
    ],
    languageOptions: {
      ...base.languageOptions,
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Глобалы Node 18+, которые ESLint без plugins не знает.
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
        performance: 'readonly',
      },
    },
    rules: {
      ...base.rules,
      // В Node браузерные глобалы бессмысленны.
      'no-restricted-globals': ['error',
        { name: 'window', message: 'это Node-модуль, window здесь нет' },
        { name: 'document', message: 'это Node-модуль, document здесь нет' },
        { name: 'localStorage', message: 'это Node-модуль, localStorage здесь нет' },
      ],
    },
  },

  // ─── Среда 3: ТЕСТЫ ───
  // В тестах допустим более свободный стиль.
  {
    files: ['src/tools/test-*.js', 'src/tools/check-*.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
