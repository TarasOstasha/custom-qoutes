const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  webpack: (config) => {
    config.module.rules.push({
      test: /[\\/]node_modules[\\/]advanced-calculator[\\/].*\.js$/,
      loader: path.resolve(__dirname, "lib/advancedCalculatorEvalLoader.js"),
    });
    return config;
  },
};

module.exports = nextConfig;
