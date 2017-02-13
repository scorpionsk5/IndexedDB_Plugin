(function (require) {

    var minify = require('minify'),
        fs = require('fs'),
        loggerString = '',
        logger = function (logEntry) {
            loggerString = loggerString + (new Date()).toISOString() + ': ' + logEntry + '\n';
        },
        writeLog = function () {
            fs.writeFile('buildLog.txt', loggerString);
        };

    logger('Build Started...');

    minify('src/indexedDB_Plugin.js', function (error, data) {
        if (error) {
            logger(error.message);
            writeLog();
        }
        else {
            fs.writeFile('build/indexedDB_Plugin.min.js', data, function (err, fileRef) {
                if (err) {
                    logger(err.message);
                }
                else {
                    logger('Build Completed Successfully!!!');
                };
                writeLog();
            });
        };
    });

})(require);
