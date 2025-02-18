#!/bin/bash -e

pushd $(dirname $0) &>/dev/null

NODE_ENV=production RATE_LIMIT_PER_MIN=240 pm2 start ../index.js --name 'quickchart' -i max --node-args="--max-http-header-size=65536"

popd &>/dev/null
