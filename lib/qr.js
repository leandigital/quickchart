const qrcode = require('qrcode');
const toSJIS = require('qrcode/helper/to-sjis');

const { logger } = require('../logging');

function renderQr(format, mode, qrData, qrOpts) {
  logger.debug('QR code', format, mode, qrOpts);

  let finalQrData = qrData;
  const finalQrOpts = qrOpts;
  if (mode === 'sjis') {
    finalQrData = [
      {
        data: qrData,
        mode: 'kanji',
      },
    ];
    finalQrOpts.toSJISFunc = toSJIS;
  }

  return new Promise((resolve, reject) => {
    if (format === 'svg') {
      qrcode
        .toString(finalQrData, finalQrOpts)
        .then(str => {
          resolve(Buffer.from(str, 'utf8'));
        })
        .catch(err => {
          logger.error('QR render error (PNG)', err);
          reject(new Error(`Could not generate QR\n${err}`));
        });
    } else {
      qrcode
        .toDataURL(finalQrData, finalQrOpts)
        .then(dataUrl => {
          resolve(Buffer.from(dataUrl.split(',')[1], 'base64'));
        })
        .catch(err => {
          logger.error('QR render error (PNG)', err);
          reject(new Error(`Could not generate QR\n${err}`));
        });
    }
  });
}

module.exports = {
  renderQr,
};
