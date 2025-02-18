const path = require('path');

const express = require('express');
const expressNunjucks = require('express-nunjucks');
const qs = require('qs');
const rateLimit = require('express-rate-limit');
const text2png = require('text2png');

const apiKeys = require('./api_keys');
const { getPdfBufferFromPng, getPdfBufferWithText } = require('./lib/pdf');
const { logger } = require('./logging');
const { renderChart } = require('./lib/charts');
const { renderQr } = require('./lib/qr');

const app = express();

const isDev = app.get('env') === 'development';

app.set('query parser', str =>
  qs.parse(str, {
    decode(s) {
      // Default express implementation replaces '+' with space. We don't want
      // that. See https://github.com/expressjs/express/issues/3453
      return decodeURIComponent(s);
    },
  }),
);
app.set('views', `${__dirname}/templates`);
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded());

if (process.env.RATE_LIMIT_PER_MIN) {
  const limitMax = parseInt(process.env.RATE_LIMIT_PER_MIN, 10);
  logger.info('Enabling rate limit:', limitMax);

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: limitMax,
    message:
      'Please slow down your requests! This is a shared public endpoint. Email contact@quickchart.io for rate limit exceptions or to purchase a commercial license.',
    onLimitReached: () => {
      logger.info('User hit rate limit!');
    },
    skip: req => {
      if (req.query.key) {
        // If user has a special key, bypass rate limiting.
        return apiKeys.has(req.query.key);
      }
      return false;
    },
  });
  app.use('/chart', limiter);
}

expressNunjucks(app, {
  watch: isDev,
  noCache: isDev,
});

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, './templates/robots.txt'));
});

function failPng(res, msg) {
  res.writeHead(500, {
    'Content-Type': 'image/png',
  });
  res.end(
    text2png(`Chart Error: ${msg}`, {
      padding: 10,
      backgroundColor: '#fff',
    }),
  );
}

async function failPdf(res, msg) {
  const buf = await getPdfBufferWithText(msg);
  res.writeHead(500, {
    'Content-Type': 'application/pdf',
  });
  res.end(buf);
}

function doRenderChart(req, res, opts) {
  opts.failFn = failPng;
  opts.onRenderHandler = buf => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,

      // 1 week cache
      'Cache-Control': 'public, max-age=604800',
    });
    res.end(buf);
  };
  doRender(req, res, opts);
}

async function doRenderPdf(req, res, opts) {
  opts.failFn = failPdf;
  opts.onRenderHandler = async buf => {
    const pdfBuf = await getPdfBufferFromPng(buf);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuf.length,

      // 1 week cache
      'Cache-Control': 'public, max-age=604800',
    });
    res.end(pdfBuf);
  };
  doRender(req, res, opts);
}

function doRender(req, res, opts) {
  if (!opts.chart) {
    opts.failFn(res, 'You are missing variable `c` or `chart`');
    return;
  }

  let height = 300;
  let width = 500;
  if (opts.height) {
    const heightNum = parseInt(opts.height, 10);
    if (!Number.isNaN(heightNum)) {
      height = heightNum;
    }
  }
  if (opts.width) {
    const widthNum = parseInt(opts.width, 10);
    if (!Number.isNaN(widthNum)) {
      width = widthNum;
    }
  }

  let untrustedInput;
  try {
    untrustedInput = opts.chart;
  } catch (err) {
    logger.error('URI malformed', err);
    opts.failFn(res, err);
    return;
  }

  const backgroundColor = opts.backgroundColor || 'transparent';

  renderChart(width, height, backgroundColor, untrustedInput)
    .then(opts.onRenderHandler)
    .catch(err => {
      logger.error('Chart error', err);
      opts.failFn(res, err);
    });
}

app.get('/chart', (req, res) => {
  const opts = {
    chart: req.query.c || req.query.chart,
    height: req.query.h || req.query.height,
    width: req.query.w || req.query.width,
    backgroundColor: req.query.backgroundColor || req.query.bkg,
  };

  const outputFormat = (req.query.f || req.query.format || '').toLowerCase();

  if (outputFormat === 'pdf') {
    doRenderPdf(req, res, opts);
  } else {
    doRenderChart(req, res, opts);
  }
});

app.post('/chart', (req, res) => {
  const opts = {
    chart: req.body.c || req.body.chart,
    height: req.body.h || req.body.height,
    width: req.body.w || req.body.width,
    backgroundColor: req.body.backgroundColor || req.body.bkg,
  };
  const outputFormat = (req.body.f || req.body.format || '').toLowerCase();

  if (outputFormat === 'pdf') {
    doRenderPdf(req, res, opts);
  } else {
    doRenderChart(req, res, opts);
  }
});

app.get('/qr', (req, res) => {
  if (!req.query.text) {
    failPng(res, 'You are missing variable `text`');
    return;
  }

  let format = 'png';
  if (req.query.format === 'svg') {
    format = 'svg';
  }

  const { mode } = req.query;

  const margin = parseInt(req.query.margin, 10) || 4;
  const ecLevel = req.query.ecLevel || undefined;
  const size = Math.min(3000, parseInt(req.query.size, 10)) || 150;
  const darkColor = req.query.dark || '000';
  const lightColor = req.query.light || 'fff';

  let qrData;
  try {
    qrData = decodeURIComponent(req.query.text);
  } catch (err) {
    logger.error('URI malformed', err);
    failPng(res, 'URI malformed');
    return;
  }
  const qrOpts = {
    margin,
    width: size,
    errorCorrectionLevel: ecLevel,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  };

  renderQr(format, mode, qrData, qrOpts)
    .then(buf => {
      res.writeHead(200, {
        'Content-Type': `image/${format}`,
        'Content-Length': buf.length,

        // 1 week cache
        'Cache-Control': 'public, max-age=604800',
      });
      res.end(buf);
    })
    .catch(err => {
      failPng(res, err);
    });
});

const port = process.env.PORT || 3400;
const server = app.listen(port);
logger.info('NODE_ENV:', process.env.NODE_ENV);
logger.info('Running on port', port);

if (!isDev) {
  const gracefulShutdown = function gracefulShutdown() {
    logger.info('Received kill signal, shutting down gracefully.');
    server.close(() => {
      logger.info('Closed out remaining connections.');
      process.exit();
    });

    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit();
    }, 10 * 1000);
  };

  // listen for TERM signal .e.g. kill
  process.on('SIGTERM', gracefulShutdown);

  // listen for INT signal e.g. Ctrl-C
  process.on('SIGINT', gracefulShutdown);
}

module.exports = app;
