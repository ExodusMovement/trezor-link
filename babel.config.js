module.exports = (api) => {
  api.cache(true);
  const presets = [
    [`@babel/preset-env`, {
      targets: {
        node: "8",
        electron: "6",
        chrome: "76",
        firefox: "68",
        safari: "13"
      },
    }],
    `@babel/preset-flow`,
  ];

  const plugins = [
    `@babel/plugin-transform-flow-strip-types`,
    `@babel/plugin-proposal-object-rest-spread`,
    [`@babel/plugin-transform-runtime`, {
      helpers: false,
      regenerator: true,
    }],
    [`@babel/plugin-proposal-decorators`, {
      legacy: true,
    }],
    [`@babel/plugin-proposal-class-properties`, {
      loose: true,
    }],
    `babel-plugin-inline-version`,
    `babel-plugin-add-module-exports`,
  ];

  return {
    presets,
    plugins,
  };
};
