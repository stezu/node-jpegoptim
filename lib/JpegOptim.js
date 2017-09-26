/*jshint node: true */
var childProcess = require('child_process'),
    Stream = require('stream').Stream,
    util = require('util'),
    which = require('which'),
    memoizeAsync = require('memoizeasync');

function JpegOptim(jpegOptimArgs) {
    Stream.call(this);

    this.jpegOptimArgs = jpegOptimArgs;

    if (!this.jpegOptimArgs || this.jpegOptimArgs.length === 0) {
        this.jpegOptimArgs = ['--max=85'];
    }

    this.jpegOptimArgs = this.jpegOptimArgs.concat(['--stdout', '--strip-all', '--all-progressive', '--quiet']);

    this.writable = this.readable = true;

    this.hasEnded = false;
    this.seenDataOnStdout = false;
}

util.inherits(JpegOptim, Stream);

JpegOptim.getBinaryPath = memoizeAsync(function (cb) {
    if(JpegOptim.binaryPath !== undefined) {
        setImmediate(function() {
            cb(null, JpegOptim.binaryPath);
        });
        return;
    }

    which('jpegoptim', function (err, jpegOptimBinaryPath) {
        if (err) {
            jpegOptimBinaryPath = require('jpegoptim-bin');
        }
        if (jpegOptimBinaryPath) {
            cb(null, jpegOptimBinaryPath);
        } else {
            cb(new Error('No jpegoptim binary in PATH and jpegoptim-bin does not provide a pre-built binary for your architecture'));
        }
    });
});

JpegOptim.setBinaryPath = function(binaryPath) {
    JpegOptim.binaryPath = binaryPath;
};

JpegOptim.prototype._error = function (err) {
    if (!this.hasEnded) {
        this.hasEnded = true;
        this.cleanUp();
        this.emit('error', err);
    }
};

JpegOptim.prototype.cleanUp = function () {
    if (this.jpegOptimProcess) {
        this.jpegOptimProcess.kill();
        this.jpegOptimProcess = null;
    }
    this.bufferedChunks = null;
};

JpegOptim.prototype.destroy = function () {
    if (!this.hasEnded) {
        this.hasEnded = true;
        this.cleanUp();
        this.bufferedChunks = null;
    }
};

JpegOptim.prototype.write = function (chunk) {
    if (this.hasEnded) {
        return;
    }
    if (!this.jpegOptimProcess && !this.bufferedChunks) {
        this.bufferedChunks = [];
        JpegOptim.getBinaryPath(function (err, jpegOptimBinaryPath) {
            if (this.hasEnded) {
                return;
            }
            if (err) {
                return this._error(err);
            }
            // this.commandLine = jpegOptimBinaryPath + (this.jpegOptimArgs ? ' ' + this.jpegOptimArgs.join(' ') : ''); // For debugging
            this.jpegOptimProcess = childProcess.spawn(jpegOptimBinaryPath, this.jpegOptimArgs);
            this.jpegOptimProcess.once('error', this._error.bind(this));
            this.jpegOptimProcess.stdin.once('error', this._error.bind(this));
            this.jpegOptimProcess.stdout.once('error', this._error.bind(this));

            // jpegoptim outputs results to stderr
            // this.jpegOptimProcess.stderr.on('data', function (data) {
            //     console.log(data.toString()); // For debugging
            // }.bind(this));

            this.jpegOptimProcess.once('exit', function (exitCode) {

                if (this.hasEnded) {
                    return;
                }
                if (exitCode > 0 && !this.hasEnded) {
                    this._error(new Error('The jpegoptim process exited with a non-zero exit code: ' + exitCode));
                }

                this.jpegOptimProcess = null;
                if (!this.hasEnded) {
                    if (this.seenDataOnStdout) {
                        this.emit('end');
                    } else {
                        this._error(new Error('JpegOptim: The stdout stream ended without emitting any data'));
                    }
                    this.hasEnded = true;
                }
            }.bind(this));

            this.jpegOptimProcess.stdout
                .on('data', function (chunk) {
                    this.seenDataOnStdout = true;
                    this.emit('data', chunk);
                }.bind(this));

            if (this.pauseStdoutOfJpegOptimProcessAfterStartingIt) {
                this.jpegOptimProcess.stdout.pause();
            }

            this.bufferedChunks.forEach(function (bufferedChunk) {
                if (bufferedChunk === null) {
                    this.jpegOptimProcess.stdin.end();
                } else {
                    this.jpegOptimProcess.stdin.write(bufferedChunk);
                }
            }, this);
            this.bufferedChunks = null;
        }.bind(this));
    }
    if (this.bufferedChunks) {
        this.bufferedChunks.push(chunk);
    } else {
        this.jpegOptimProcess.stdin.write(chunk);
    }
};

JpegOptim.prototype.end = function (chunk) {
    if (this.hasEnded) {
        return;
    }
    if (chunk) {
        this.write(chunk);
    } else if (!this.jpegOptimProcess) {
        // No chunks have been rewritten. Write an empty one to make sure there's jpegoptim process.
        this.write(new Buffer(0));
    }
    if (this.bufferedChunks) {
        this.bufferedChunks.push(null);
    } else {
        this.jpegOptimProcess.stdin.end();
    }
};

JpegOptim.prototype.pause = function () {
    if (this.jpegOptimProcess) {
        this.jpegOptimProcess.stdout.pause();
    } else {
        this.pauseStdoutOfJpegOptimProcessAfterStartingIt = true;
    }
};

JpegOptim.prototype.resume = function () {
    if (this.jpegOptimProcess) {
        this.jpegOptimProcess.stdout.resume();
    } else {
        this.pauseStdoutOfJpegOptimProcessAfterStartingIt = false;
    }
};

module.exports = JpegOptim;
