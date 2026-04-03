import terser from '@rollup/plugin-terser';

export default [
    {
        input: 'src/index.js',
        output: [
            {
                file: 'dist/openage.esm.js',
                format: 'es',
                sourcemap: true,
            },
            {
                file: 'dist/openage.umd.js',
                format: 'umd',
                name: 'OpenAge',
                sourcemap: true,
                exports: 'named',
            },
        ],
    },
    {
        input: 'src/index.js',
        output: {
            file: 'dist/openage.min.js',
            format: 'umd',
            name: 'OpenAge',
            sourcemap: true,
            exports: 'named',
        },
        plugins: [terser()],
    },
];
