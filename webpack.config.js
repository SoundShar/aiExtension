var path = require('path')
var webpack = require('webpack')
var CopyWebpackPlugin = require('copy-webpack-plugin')
var MiniCssExtractPlugin = require('mini-css-extract-plugin')

module.exports = function(env, argv) {
  var isProd = argv.mode === 'production'

  return {
    entry: {
      background: './src/background/serviceWorker.ts',
      content: './src/content/canvasCapture.ts',
      popup: './src/popup/popup.ts',
      offscreen: './src/offscreen/offscreen.ts',
      'js/tf-webgpu-bundle': './src/vendor/tfWebgpuBundle.ts'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      publicPath: '/'
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          },
          exclude: /node_modules/
        },
        {
          test: /\.scss$/,
          use: [
            MiniCssExtractPlugin.loader,
            'css-loader',
            'sass-loader'
          ]
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        global: 'globalThis'
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css'
      }),
      new CopyWebpackPlugin([
        { from: 'manifest.json', to: '.' },
        { from: 'src/popup/popup.html', to: 'popup.html' },
        { from: 'src/offscreen/offscreen.html', to: 'offscreen.html' },
        { from: 'public', to: '.', ignore: ['.*'] }
      ])
    ],
    devtool: isProd ? false : 'cheap-module-source-map',
    mode: argv.mode || 'development',
    node: {
      global: false,
      setImmediate: false
    },
    performance: {
      hints: false
    }
  }
}
