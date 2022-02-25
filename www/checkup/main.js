define([
    'jquery',
    '/api/config',
    '/assert/assertions.js',
    '/common/hyperscript.js',
    '/customize/messages.js',
    '/common/dom-ready.js',
    '/bower_components/nthen/index.js',
    '/common/sframe-common-outer.js',
    '/customize/login.js',
    '/common/common-hash.js',
    '/common/common-util.js',
    '/common/pinpad.js',
    '/common/outer/network-config.js',
    '/customize/pages.js',
    '/checkup/checkup-tools.js',
    '/customize/application_config.js',

    '/bower_components/tweetnacl/nacl-fast.min.js',
    'css!/bower_components/components-font-awesome/css/font-awesome.min.css',
    'less!/checkup/app-checkup.less',
], function ($, ApiConfig, Assertions, h, Messages, DomReady,
            nThen, SFCommonO, Login, Hash, Util, Pinpad,
            NetConfig, Pages, Tools, AppConfig) {
    var Assert = Assertions();
    var trimSlashes = function (s) {
        if (typeof(s) !== 'string') { return s; }
        return s.replace(/\/+$/, '');
    };

    var assert = function (f, msg) {
        Assert(f, msg || h('span.advisory-text.cp-danger'));
    };

    var code = function (content) {
        return h('code', content);
    };

    var CONFIG_PATH = function () {
        return code('cryptpad/config/config.js');
    };
    var API_CONFIG_LINK = function () {
        return h('a', {
            href: '/api/config',
            target: '_blank',
        }, '/api/config');
    };

    var RESTART_WARNING = function () {
        return h('span', [
            'Changes to ',
            CONFIG_PATH(),
            ' will require a server restart in order for ',
            API_CONFIG_LINK(),
            ' to be updated.',
        ]);
    };

    var link = function (href, text) {
        return h('a', {
            href: href,
            rel: 'noopener noreferrer',
            target: '_blank',
        }, text);
    };

    var setWarningClass = function (msg) {
        $(msg).removeClass('cp-danger').addClass('cp-warning');
    };

    var cacheBuster = Tools.cacheBuster;

    var trimmedSafe = trimSlashes(ApiConfig.httpSafeOrigin);
    var trimmedUnsafe = trimSlashes(ApiConfig.httpUnsafeOrigin);
    var fileHost = ApiConfig.fileHost;

    var API_URL;
    try {
        API_URL = new URL(NetConfig.getWebsocketURL(window.location.origin), trimmedUnsafe);
    } catch (err) {
        console.error(err);
    }

    var ACCOUNTS_URL;
    try {
        if (typeof(AppConfig.upgradeURL) === 'string') {
            ACCOUNTS_URL = new URL(AppConfig.upgradeURL, trimmedUnsafe).origin;
        }
    } catch (err) {
        console.error(err);
    }

    var debugOrigins = {
        httpUnsafeOrigin: trimmedUnsafe,
        httpSafeOrigin: trimmedSafe,
        currentOrigin: window.location.origin,
    };

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            "CryptPad's sandbox requires that both ",
            code('httpUnsafeOrigin'),
            ' and ',
            code('httpSafeOrigin'),
            " be configured in ",
            CONFIG_PATH(),
            '. ',
            RESTART_WARNING(),
        ]));

        //console.error(trimmedSafe, trimmedUnsafe);
        cb(Boolean(trimmedSafe && trimmedUnsafe) || debugOrigins);
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            code('httpUnsafeOrigin'),
            ' and ',
            code('httpSafeOrigin'),
            ' are equivalent. ',
            "In order for CryptPad's security features to be as effective as intended they must be different. ",
            "See ",
            CONFIG_PATH(),
            '. ',
            RESTART_WARNING(),
        ]));

        return void cb(trimmedSafe !== trimmedUnsafe || trimmedUnsafe);
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            code('httpUnsafeOrigin'),
            ' and ',
            code('httpSafeOrigin'),
            ' must not contain trailing slashes. This can be configured in ',
            CONFIG_PATH(),
            '. ',
            RESTART_WARNING(),
        ]));
        var result = trimmedSafe === ApiConfig.httpSafeOrigin &&
                     trimmedUnsafe === ApiConfig.httpUnsafeOrigin;

        cb(result || debugOrigins);
    });

    assert(function (cb, msg) {
        msg.appendChild(h("span", [
            "It appears that you are trying to load this page via an origin other than its main domain (",
            code(ApiConfig.httpUnsafeOrigin),

            "). See the ",
            code('httpUnsafeOrigin'),
            " option in ",
            CONFIG_PATH(),
            " which is exposed via ",
            API_CONFIG_LINK(),
            '.',
        ]));
        var origin = window.location.origin;
        return void cb(ApiConfig.httpUnsafeOrigin === origin || debugOrigins);
    });

    var checkAvailability = function (url, cb) {
        $.ajax({
            url: cacheBuster(url),
            data: {},
            complete: function (xhr) {
                cb(xhr.status === 200 || xhr.status);
            },
        });
    };

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            "The main domain (configured via ",
            code('httpUnsafeOrigin'),
            ' as ',
            ApiConfig.httpUnsafeOrigin,
            ' in ',
            CONFIG_PATH(),
            ' and exposed via ',
            API_CONFIG_LINK(),
            ') could not be reached.',
        ]));

        checkAvailability(trimmedUnsafe, cb);
    });

    // Try loading an iframe on the safe domain
    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            "Your browser was not able to load an iframe using the origin specified as ",
            code("httpSafeOrigin"),
            " (",
            ApiConfig.httpSafeOrigin,
            ") in ",
            CONFIG_PATH(),
            ". This can be caused by an invalid ",
            code('httpUnsafeDomain'),
            ', invalid CSP configuration in your reverse proxy, invalid SSL certificates, and many other factors. ',
            'More information about your particular error may be found in your browser console. ',
            RESTART_WARNING(),
        ]));

        var to;
        nThen(function (waitFor) {
            DomReady.onReady(waitFor());
        }).nThen(function (waitFor) {
            to = setTimeout(function () {
                console.error('TIMEOUT loading iframe on the safe domain');
                cb('TIMEOUT');
            }, 10000);
            SFCommonO.initIframe(waitFor);
        }).nThen(function () {
            // Iframe is loaded
            clearTimeout(to);
            console.log("removing sandbox iframe");
            $('iframe#sbox-iframe').remove();
            cb(true);
        });
    });

    var shared_websocket;
    // Test Websocket
    var evWSError = Util.mkEvent(true);
    assert(function (_cb, msg) {
        var timeoutErr = 'Could not connect to the websocket server within 5 seconds.';
        var cb = Util.once(Util.both(_cb, function (status) {
            if (status === true) { return; }
            msg.appendChild(h('span#websocket', [
                status || 'Unknown websocket error',
            ]));
        }));

        var ws = new WebSocket(NetConfig.getWebsocketURL());
        shared_websocket = ws;
        var to = setTimeout(function () {
            console.error('Websocket TIMEOUT');
            evWSError.fire();
            cb(timeoutErr);
        }, 10000);
        ws.onopen = function () {
            clearTimeout(to);
            cb(true);
        };
        ws.onerror = function (err) {
            clearTimeout(to);
            console.error('[Websocket error]', err);
            evWSError.fire();
            cb('Unable to connect to the websocket server. More information may be available in your browser console ([Websocket error]).');
        };
    });

    // Test login block
    var shared_realtime;
    assert(function (_cb, msg) {
        var websocketErr = "No WebSocket available";
        var cb = Util.once(Util.both(_cb, function (status) {
            if (status === true) { return; }
            if (status === websocketErr) {
                msg.appendChild(h('span', [
                    websocketErr,
                    ' See ',
                    h('a', {
                        href: '#websocket',
                    }, 'the related websocket error'),
                ]));
                return;
            }
            // else
            msg.appendChild(h('span', [
                "Unable to create, retrieve, or remove encrypted credentials from the server. ",
                "This is most commonly caused by a mismatch between the value of the  ",
                code('blockPath'),
                ' value configured in ',
                CONFIG_PATH(),
                " and the corresponding settings in your reverse proxy's configuration file,",
                " but it can also be explained by a websocket error. ",
                RESTART_WARNING(),
            ]));
        }));

        // time out after 30 seconds
        setTimeout(function () {
            cb('TIMEOUT');
        }, 30000);

        var bytes = new Uint8Array(Login.requiredBytes);

        var opt = Login.allocateBytes(bytes);

        var blockUrl = Login.Block.getBlockUrl(opt.blockKeys);
        var blockRequest = Login.Block.serialize("{}", opt.blockKeys);
        var removeRequest = Login.Block.remove(opt.blockKeys);
        console.warn('Testing block URL (%s). One 404 is normal.', blockUrl);

        var userHash = '/2/drive/edit/000000000000000000000000';
        var secret = Hash.getSecrets('drive', userHash);
        opt.keys = secret.keys;
        opt.channelHex = secret.channel;

        var RT, rpc, exists, restricted;

        nThen(function (waitFor) {
            Util.fetch(blockUrl, waitFor(function (err) {
                if (err) { return; } // No block found
                exists = true;
            }));
        }).nThen(function (waitFor) {
            // If WebSockets aren't working, don't wait forever here
            evWSError.reg(function () {
                waitFor.abort();
                cb(websocketErr);
            });
            // Create proxy
            Login.loadUserObject(opt, waitFor(function (err, rt) {
                if (err) {
                    waitFor.abort();
                    console.error("Can't create new channel. This may also be a websocket issue.");
                    return void cb(false);
                }
                shared_realtime = RT = rt;
                var proxy = rt.proxy;
                proxy.edPublic = opt.edPublic;
                proxy.edPrivate = opt.edPrivate;
                proxy.curvePublic = opt.curvePublic;
                proxy.curvePrivate = opt.curvePrivate;
                rt.realtime.onSettle(waitFor());
            }));
        }).nThen(function (waitFor) {
            // Init RPC
            Pinpad.create(RT.network, RT.proxy, waitFor(function (e, _rpc) {
                if (e) {
                    waitFor.abort();
                    console.error("Can't initialize RPC", e); // INVALID_KEYS
                    return void cb(false);
                }
                rpc = _rpc;
            }));
        }).nThen(function (waitFor) {
            // Write block
            if (exists) { return; }
            rpc.writeLoginBlock(blockRequest, waitFor(function (e) {
                // we should tolerate restricted registration
                // and proceed to clean up after any data we've created
                if (e === 'E_RESTRICTED') {
                    restricted = true;
                    return void cb(true);
                }
                if (e) {
                    waitFor.abort();
                    console.error("Can't write login block", e);
                    return void cb(false);
                }
            }));
        }).nThen(function (waitFor) {
            if (restricted) { return; }
            // Read block
            Util.fetch(blockUrl, waitFor(function (e) {
                if (e) {
                    waitFor.abort();
                    console.error("Can't read login block", e);
                    return void cb(false);
                }
            }));
        }).nThen(function (waitFor) {
            // Remove block
            rpc.removeLoginBlock(removeRequest, waitFor(function (e) {
                if (restricted) { return; } // an ENOENT is expected in the case of restricted registration, but we call this anyway to clean up any mess from previous tests.
                if (e) {
                    waitFor.abort();
                    console.error("Can't remove login block", e);
                    console.error(blockRequest);
                    return void cb(false);
                }
            }));
        }).nThen(function (waitFor) {
            rpc.removeOwnedChannel(secret.channel, waitFor(function (e) {
                if (e) {
                    waitFor.abort();
                    console.error("Can't remove channel", e);
                    return void cb(false);
                }
            }));
        }).nThen(function () {
            cb(true);
        });
    });

    var sheetURL = '/common/onlyoffice/v5/web-apps/apps/spreadsheeteditor/main/index.html';

    assert(function (cb, msg) {
        msg.innerText = "Missing HTTP headers required for .xlsx export from sheets. ";
        var expect = {
            'cross-origin-resource-policy': 'cross-origin',
            'cross-origin-embedder-policy': 'require-corp',
        };

        Tools.common_xhr(sheetURL, function (xhr) {
            var result = !Object.keys(expect).some(function (k) {
                var response = xhr.getResponseHeader(k);
                if (response !== expect[k]) {
                    msg.appendChild(h('span', [
                        'A value of ',
                        code(expect[k]),
                        ' was expected for the ',
                        code(k),
                        ' HTTP header, but instead a value of "',
                        code(response),
                        '" was received.',
                    ]));
                    return true; // returning true indicates that a value is incorrect
                }
            });
            cb(result || xhr.getAllResponseHeaders());
        });
    });

    assert(function (cb, msg) {
        setWarningClass(msg);

        var printMessage = function (value) {
            msg.appendChild(h('span', [
                "This instance hasn't opted out of participation in Google's ",
                code('FLoC'),
                " targeted advertizing network. ",

                "This can be done by setting a ",
                code('permissions-policy'),
                " HTTP header with a value of ",
                code('"interest-cohort=()"'),
                " in the configuration of its reverse proxy instead of the current value (",
                code(value),
                "). See the provided NGINX configuration file for an example. ",

                h('p', [
                    link("https://www.eff.org/deeplinks/2021/04/am-i-floced-launch", 'Learn more'),
                ]),
            ]));
        };

        Tools.common_xhr('/', function (xhr) {
            var header = xhr.getResponseHeader('permissions-policy') || '';
            var rules = header.split(',');
            if (rules.includes('interest-cohort=()')) { return void cb(true); }
            printMessage(JSON.stringify(header));
            cb(header);
        });
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            code('/api/broadcast'),
            " could not be loaded. This can be caused by an outdated application server or an incorrectly configured reverse proxy. ",
            "Even if the most recent code has been downloaded it's possible the application server has not been restarted. ",
            "Your browser console may provide more details as to why this resource could not be loaded. ",
        ]));

        Tools.common_xhr('/api/broadcast', function (xhr) {
            var status = xhr.status;
            cb(status === 200 || status);
        });
    });

    var checkAPIHeaders = function (url, msg, cb) {
        Tools.common_xhr(url, function (xhr) {
            var allHeaders = xhr.getAllResponseHeaders();
            var headers = {};
            var duplicated = allHeaders.split('\n').some(function (header) {
                var duplicate;
                header.replace(/([^:]+):(.*)/, function (all, type, value) {
                    type = type.trim();
                    if (typeof(headers[type]) !== 'undefined') {
                        duplicate = true;
                    }
                    headers[type] = value.trim();
                });
                return duplicate;
            });

            var expect = {
                'cross-origin-resource-policy': 'cross-origin',
                'cross-origin-embedder-policy': 'require-corp',
            };
            var incorrect = false;

            Object.keys(expect).forEach(function (k) {
                var response = xhr.getResponseHeader(k);
                var expected = expect[k];
                if (response === expected) { return; }
                incorrect = true;
                msg.appendChild(h('p', [
                    'The ',
                    code(k),
                    ' header for ',
                    code(url),
                    " is '",
                    code(response),
                    "' instead of '",
                    code(expected),
                    "' as expected.",
                ]));
            });
            cb((!duplicated && !incorrect) || allHeaders);
        });
    };

    var INCORRECT_HEADER_TEXT = ' was served with duplicated or incorrect headers. Compare your reverse-proxy configuration against the provided example.';

    assert(function (cb, msg) {
        var url = '/api/config';
        msg.innerText = url + INCORRECT_HEADER_TEXT;
        checkAPIHeaders(url, msg, cb);
    });

    assert(function (cb, msg) {
        var url = '/api/broadcast';
        msg.innerText = url + INCORRECT_HEADER_TEXT;
        checkAPIHeaders(url, msg, cb);
    });

    assert(function (cb, msg) {
        var email = ApiConfig.adminEmail;
        if (typeof(email) === 'string' && email && email !== 'i.did.not.read.my.config@cryptpad.fr') {
            return void cb(true);
        }

        setWarningClass(msg);
        msg.appendChild(h('span', [
            'This instance does not provide a valid ',
            code('adminEmail'),
            ' which can make it difficult to contact its adminstrator to report vulnerabilities or abusive content.',
            " This can be configured on your instance's admin panel. Use the provided ",
            code("Flush cache'"),
            " button for this change to take effect for all users.",
        ]));
        cb(email);
    });

    assert(function (cb, msg) {
        var support = ApiConfig.supportMailbox;
        setWarningClass(msg);
        msg.appendChild(h('span', [
            "This instance's encrypted support ticket functionality has not been enabled. This can make it difficult for its users to safely report issues that concern sensitive information. ",
            "This can be configured via the admin panel's ",
            code('Support'),
            " tab.",
        ]));
        cb(support && typeof(support) === 'string' && support.length === 44);
    });

    assert(function (cb, msg) {
        var adminKeys = ApiConfig.adminKeys;
        if (Array.isArray(adminKeys) && adminKeys.length >= 1 && typeof(adminKeys[0]) === 'string' && adminKeys[0].length === 44) {
            return void cb(true);
        }
        setWarningClass(msg);
        msg.appendChild(h('span', [
            "This instance has not been configured to support web administration. This can be enabled by adding a registered user's public signing key to the ",
            code('adminKeys'),
            ' array in ',
            CONFIG_PATH(),
            '. ',
            RESTART_WARNING(),
        ]));
        cb(false);
    });

    var response = Util.response(function (err) {
        console.error('SANDBOX_ERROR', err);
    });

    var sandboxIframe = h('iframe', {
        class: 'sandbox-test',
        src: cacheBuster(trimmedSafe + '/checkup/sandbox/index.html'),
    });
    document.body.appendChild(sandboxIframe);

    var sandboxIframeReady = Util.mkEvent(true);
    setTimeout(function () {
        sandboxIframeReady.fire("TIMEOUT");
    }, 10 * 1000);

    var postMessage = function (content, cb) {
        try {
            var txid = Util.uid();
            content.txid = txid;
            response.expect(txid, cb, 15000);
            sandboxIframe.contentWindow.postMessage(JSON.stringify(content), '*');
        } catch (err) {
            console.error(err);
        }
    };

    var deferredPostMessage = function (content, _cb) {
        var cb = Util.once(Util.mkAsync(_cb));
        nThen(function (w) {
            sandboxIframeReady.reg(w(function (err) {
                if (!err) { return; }
                w.abort();
                cb(err);
            }));
        }).nThen(function () {
            postMessage(content, cb);
        });
    };

    window.addEventListener('message', function (event) {
        try {
            var msg = JSON.parse(event.data);
            if (msg.command === 'READY') { return void sandboxIframeReady.fire(); }
            if (msg.q === "READY") { return; } // ignore messages from the usual sandboxed iframe
            var txid = msg.txid;
            if (!txid) { return console.log("no handler for ", txid); }
            response.handle(txid, msg.content);
        } catch (err) {
            console.error(event);
            console.error(err);
        }
    });

    var parseCSP = function (CSP) {
        if (!CSP) { return {}; }
        //console.error(CSP);
        var CSP_headers = {};
        CSP.split(";")
        .forEach(function (rule) {
            rule = (rule || "").trim();
            if (!rule) { return; }
            var parts = rule.split(/\s/);
                var first = parts[0];
                var rest = rule.slice(first.length + 1);
                CSP_headers[first] = rest;
                //console.error(rule.trim());
                //console.info("[%s] '%s'", first, rest);
            });
        return CSP_headers;
    };

    var hasUnsafeEval = function (CSP_headers) {
        return /unsafe\-eval/.test(CSP_headers['script-src']);
    };

    var hasUnsafeInline = function (CSP_headers) {
        return /unsafe\-inline/.test(CSP_headers['script-src']);
    };

    var hasOnlyOfficeHeaders = function (CSP_headers) {
        if (!hasUnsafeEval(CSP_headers)) {
            console.error("NO_UNSAFE_EVAL");
            console.log(CSP_headers);
            return false;
        }
        if (!hasUnsafeInline(CSP_headers)) {
            console.error("NO_UNSAFE_INLINE");
            return void false;
        }
        return true;
    };

    var CSP_WARNING = function (url) {
         return h('span', [
            code(url),
            ' does not have the required ',
            code("'content-security-policy'"),
            ' headers set. This is most often related to incorrectly configured sandbox domains or reverse proxies.',
        ]);
    };

    assert(function (_cb, msg) { // FIXME possibly superseded by more advanced CSP tests?
        var url = '/sheet/inner.html';
        var cb = Util.once(Util.mkAsync(_cb));
        msg.appendChild(CSP_WARNING(url));
        deferredPostMessage({
            command: 'GET_HEADER',
            content: {
                url: url,
                header: 'content-security-policy',
            },
        }, function (content) {
            var CSP_headers = parseCSP(content);
            cb(hasOnlyOfficeHeaders(CSP_headers) || CSP_headers);
        });
    });

    assert(function (cb, msg) { // FIXME possibly superseded by more advanced CSP tests?
        var url = '/common/onlyoffice/v5/web-apps/apps/spreadsheeteditor/main/index.html';
        msg.appendChild(CSP_WARNING(url));
        deferredPostMessage({
            command: 'GET_HEADER',
            content: {
                url: url,
                header: 'content-security-policy',
            },
        }, function (content) {
            var CSP_headers = parseCSP(content);
            cb(hasOnlyOfficeHeaders(CSP_headers) || CSP_headers);
        });
    });

/*
    assert(function (cb, msg) {
        var url = '/sheet/inner.html';
        msg.appendChild(h('span', [
            code(url),
            ' does not have the required ',
            code("'cross-origin-opener-policy'"),
            ' headers set.',
        ]));
        deferredPostMessage({
            command: 'GET_HEADER',
            content: {
                url: url,
                header: 'cross-origin-opener-policy',
            },
        }, function (content) {
            cb(content === 'same-origin');
        });
    });
*/

    var safariGripe = function () {
        return h('p.cp-notice-other', 'This is expected because Safari and platforms that use its engine lack commonly supported functionality.');
    };

    var browserIssue = function () {
        return h('p.cp-notice-other', 'This test checks for the presence of features in your browser and is not necessarily caused by server misconfiguration.');
    };

    assert(function (cb, msg) {
        cb = Util.once(cb);
        setWarningClass(msg);
        var notice = h('span', [
            h('p', 'It appears that some features required for Office file format conversion are not present.'),
            Tools.isSafari()? safariGripe(): undefined,
            browserIssue(),
        ]);

        msg.appendChild(notice);

        var expected = [
            'Atomics',
            'SharedArrayBuffer',
            'WebAssembly',
            ['WebAssembly', 'Memory'],
            ['WebAssembly', 'instantiate'],
            ['WebAssembly', 'instantiateStreaming'],
            ['Buffer', 'from'],

            'SharedWorker',
            'worker',
            'crossOriginIsolated',
        ];

        var responses = {};

        nThen(function (w) {
            deferredPostMessage({
                command: 'CHECK_JS_APIS',
                content: {
                    globals: expected,
                },
            }, w(function (response) {
                Util.extend(responses, response);
            }));

            deferredPostMessage({
                command: 'FANCY_API_CHECKS',
                content: {
                },
            }, w(function (response) {
                Util.extend(responses, response);
            }));
        }).nThen(function () {
            if (!responses.Atomics || !responses.WebAssembly) {
                return void cb(responses);
            }
            if (responses.SharedArrayBuffer || responses.SharedArrayBufferFallback) {
                return cb(true);
            }
            return void cb(response);
        });
    });

    var isHTTPS = function (host) {
        return /^https:\/\//.test(host);
    };

    var isOnion = function (host) {
        return /\.onion$/.test(host);
    };
    var isLocalhost = function (host) {
        return /^http:\/\/localhost/.test(host);
    };

    assert(function (cb, msg) {
        // provide an exception for development instances
        if (isLocalhost(trimmedUnsafe) && isLocalhost(window.location.href)) { return void cb(true); }

        // if both the main and sandbox domains are onion addresses
        // then the HTTPS requirement is unnecessary
        if (isOnion(trimmedUnsafe) && isOnion(trimmedSafe)) { return void cb(true); }

        // otherwise expect that both inner and outer domains use HTTPS
        msg.appendChild(h('span', [
            "Both ",
            code('httpUnsafeOrigin'),
            ' and ',
            code('httpSafeOrigin'),
            ' should be accessed via HTTPS for production use. ',
            "This can be configured via ",
            CONFIG_PATH(),
            '. ',
            RESTART_WARNING(),
        ]));
        cb(isHTTPS(trimmedUnsafe) && isHTTPS(trimmedSafe) || debugOrigins);
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            code('/api/config'),
            " returned an HTTP status code other than ",
            code('200'),
            ' when accessed from the sandbox domain.',
        ]));
        deferredPostMessage({
            command: 'CHECK_HTTP_STATUS',
            content: {
                url: cacheBuster('/api/config'),
            },
        }, function (content) {
            cb(content === 200 || content);
        });
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            "An invalid ",
            code("fileHost"),
            " value was provided by ",
            code('/api/config'),
            '.',
        ]));
        // it's OK not to provide a 'fileHost' value
        if (typeof(fileHost) === 'undefined') { return void cb(true); }
        // if one is provided, we expect it to be HTTPS
        if (!isHTTPS(fileHost)) { return void cb(fileHost); }
        // Otherwise I guess it's OK?
        cb(true);
    });

    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            'This instance is configured to use an invalid websocket URL.',
        ]));

        if (!API_URL) { return void cb('INVALID_WEBSOCKET'); }

        if (isHTTPS(trimmedUnsafe) && API_URL.protocol !== 'wss:') {
            return void cb("PROTOCOL_MISMATCH");
        }

        return void cb(true);
    });

/*
    assert(function (cb, msg) {
        msg.appendChild(h('span', [
            'all headers',
        ]));

        Tools.common_xhr('/', function (xhr) {
            var all_headers = xhr.getAllResponseHeaders().split(/\r|\n/).filter(Boolean);
            cb(all_headers);
        });
    });
*/

    var CSP_DESCRIPTIONS = {
        'default-src': '',
        'style-src': '',
        'font-src': '',
        'child-src': '',
        'frame-src': '',
        'script-src': '',
        'connect-src': "This rule restricts which URLs can be loaded by scripts. Overly permissive settings can allow users to be tracking using external resources, while overly restrictive settings may block pages from loading entirely.",
        'img-src': '',
        'media-src': '',
        'worker-src': '',
        'manifest-src': '',

        'frame-ancestors': ' This rule determines which sites can embed content from this instance in an iframe.',
    };

    var validateCSP = function (raw, msg, expected) {
        var CSP = parseCSP(raw);
        var checkRule = function (attr, rules) {
            var v = CSP[attr];
            // return `true` if you fail this test...
            if (typeof(v) !== 'string' || !v) { return true; }
            var l = rules.length;
            for (var i = 0;i < l;i++) {
                if (typeof(rules[i]) !== 'undefined' && !v.includes(rules[i])) { return true; }
                v = v.replace(rules[i], '');
            }
            return v.trim();
        };
        var failed;
        Object.keys(expected).forEach(function (dir) {
            var result = checkRule(dir, expected[dir]);
            if (!failed && result) { failed = true; }
            if (!result) { return; }
            msg.appendChild(h('p', [
                'A value of ',
                code('"' + expected[dir].filter(Boolean).join(' ') + '"'),
                ' was expected for the ',
                code(dir),
                ' directive.',
                CSP_DESCRIPTIONS[dir]
            ]));
/*
            console.log('BAD_HEADER:', {
                rule: dir,
                expected: expected[dir],
                result: result,
            });
*/
        });

        if (failed) { return parseCSP(raw); }

        return true;
    };

    assert(function (_cb, msg) {
        var url = '/sheet/inner.html';
        var cb = Util.once(Util.mkAsync(_cb));
        msg.appendChild(h('span', [
            code(trimmedUnsafe + url),
            ' was served with incorrect ',
            code('Content-Security-Policy'),
            ' headers.',
        ]));

        //msg.appendChild(CSP_WARNING(url));
        deferredPostMessage({
            command: 'GET_HEADER',
            content: {
                url: url,
                header: 'content-security-policy',
            },
        }, function (raw) {
            var $outer = trimmedUnsafe;
            var $sandbox = trimmedSafe;
            var result = validateCSP(raw, msg, {
                'default-src': ["'none'"],
                'style-src': ["'unsafe-inline'", "'self'", $outer],
                'font-src': ["'self'", 'data:', $outer],
                'child-src': [$outer],
                'frame-src': ["'self'", 'blob:', $sandbox],
                'script-src': ["'self'", 'resource:', $outer,
                    "'unsafe-eval'",
                    "'unsafe-inline'",
                ],
                'connect-src': [
                    "'self'",
                    'blob:',
                    $outer,
                    $sandbox,
                    API_URL.origin,
                    isHTTPS(fileHost)? fileHost: undefined,
                    // support for cryptpad.fr configuration
                    AppConfig.accounts_api,
                    ![trimmedUnsafe, trimmedSafe].includes(ACCOUNTS_URL)? ACCOUNTS_URL: undefined,
                ],

                'img-src': ["'self'", 'data:', 'blob:', $outer],
                'media-src': ['blob:'],
                //'frame-ancestors': ['*'], // XXX IFF you want to support remote embedding
                'worker-src': ["'self'"], // , $outer, $sandbox],
            });
            cb(result);
        });
    });

    assert(function (cb, msg) {
        var header = 'content-security-policy';
        msg.appendChild(h('span', [
            code(trimmedUnsafe + '/'),
            ' was served with incorrect ',
            code('Content-Security-Policy'),
            ' headers.',
        ]));
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            var $outer = trimmedUnsafe;
            var $sandbox = trimmedSafe;
            var result = validateCSP(raw, msg, {
                'default-src': ["'none'"],
                'style-src': ["'unsafe-inline'", "'self'", $outer],
                'font-src': ["'self'", 'data:', $outer],
                'child-src': [$outer],
                'frame-src': ["'self'", 'blob:', $sandbox],
                'script-src': ["'self'", 'resource:', $outer],
                'connect-src': [
                    "'self'",
                    'blob:',
                    $outer,
                    $sandbox,
                    API_URL.origin,
                    isHTTPS(fileHost)? fileHost: undefined,
                    AppConfig.accounts_api,
                    ![trimmedUnsafe, trimmedSafe].includes(ACCOUNTS_URL)? ACCOUNTS_URL: undefined,
                ],
                'img-src': ["'self'", 'data:', 'blob:', $outer],
                'media-src': ['blob:'],
                //'frame-ancestors': ['*'], // XXX IFF you want to support remote embedding
                'worker-src': ["'self'"],//, $outer, $sandbox],
            });

            cb(result);
        });
    });

    assert(function (cb, msg) {
        var header = 'Access-Control-Allow-Origin';
        msg.appendChild(h('span', [
            'Assets must be served with an ',
            code(header),
            ' header with a value of ',
            code("'*'"),
            ' if you wish to support embedding of encrypted media on third party websites.',
        ]));
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(raw === "*" || raw);
        });
    });

    assert(function (cb, msg) {
        var header = 'Cross-Origin-Embedder-Policy';
        msg.appendChild(h('span', [
            "Assets must be served with a ",
            code(header),
            ' value of ',
            code('require-corp'),
            " to enable browser features required for client-side document conversion.",
        ]));
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(raw === 'require-corp' || raw);
        });
    });

    assert(function (cb, msg) {
        var header = 'Cross-Origin-Resource-Policy';
        msg.appendChild(h('span', [
            "Assets must be served with a ",
            code(header),
            ' value of ',
            code('cross-origin'),
            " to enable browser features required for client-side document conversion.",
        ]));
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(raw === 'cross-origin' || raw);
        });
    });

    assert(function (cb, msg) {
        var header = 'X-Content-Type-Options';
        msg.appendChild(h('span', [
            "Assets should be served with an ",
            code(header),
            ' header with a value of ',
            code('nosniff'),
            '.',
        ]));
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(raw === 'nosniff' || raw);
        });
    });

    assert(function (cb, msg) {
        var header = 'Cache-Control';
        msg.appendChild(h('span', [
            'Assets requested without a version parameter should be served with a ',
            code('no-cache'),
            ' value for the ',
            code("Cache-Control"),
            ' header.',
        ]));
        // Cache-Control should be 'no-cache' unless the URL includes ver=
        Tools.common_xhr('/', function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(raw === 'no-cache' || raw);
        });
    });

    assert(function (cb, msg) {
        var header = 'Cache-Control';
        msg.appendChild(h('span', [
            'Assets requested with a version parameter should be served with a long-lived ',
            code('Cache-Control'),
            ' header.',
        ]));
        // Cache-Control should be 'max-age=<number>' if the URL includes 'ver='
        Tools.common_xhr('/customize/messages.js?ver=' +(+new Date()), function (xhr) {
            var raw = xhr.getResponseHeader(header);
            cb(/max\-age=\d+$/.test(raw) || raw);
        });
    });

    var serverToken;
    Tools.common_xhr('/', function (xhr) {
        serverToken = xhr.getResponseHeader('server');
    });

    var row = function (cells) {
        return h('tr', cells.map(function (cell) {
            return h('td', cell);
        }));
    };

    var failureReport = function (obj) {
        var printableValue = obj.output;
        try {
            printableValue = JSON.stringify(obj.output, null, ' ');
        } catch (err) {
            console.error(err);
        }

        return h('div.error', [
            h('h5', obj.message),
            h('div.table-container',
                h('table', [
                    row(["Failed test number", obj.test + 1]),
                    row(["Returned value", h('pre', code(printableValue))]),
                ])
            ),
        ]);
    };

    var completed = 0;
    var $progress = $('#cp-progress');

    var versionStatement = function () {
        return h('p.cp-notice-version', [
            "This instance is running ",
            h('span.cp-app-checkup-version',[
                "CryptPad",
                ' ',
                Pages.versionString,
            ]),
            '.',
        ]);
    };

    var browserStatement = function () {
        var name = Tools.guessBrowser();
        if (!name) { return; }
        return h('p.cp-notice-browser', [
            "You appear to be using a ",
            h('span.cp-app-checkup-browser', name),
            ' browser on ',
            h('span.underline', Tools.guessOS()),
            ' to view this page.',
        ]);
    };

    var serverStatement = function (token) {
        if ([null, undefined].includes(token)) { return undefined; }
        return h('p.cp-notice-other', [
            "Page content was served by ",
            code('"' + token + '"'),
            '.',
        ]);
    };

    Assert.run(function (state) {
        var errors = state.errors;
        var failed = errors.length;

        Messages.assert_numberOfTestsPassed = "{0} / {1} tests passed.";

        var statusClass = failed? 'failure': 'success';

        var failedDetails = "Details found below";
        var successDetails = "This checkup only tests the most common configuration issues. You may still experience errors or incorrect behaviour.";
        var details = h('p.cp-notice-details', failed? failedDetails: successDetails);

        var summary = h('div.summary.' + statusClass, [
            versionStatement(),
            serverStatement(serverToken),
            browserStatement(),
            h('p', Messages._getKey('assert_numberOfTestsPassed', [
                state.passed,
                state.total
            ])),
            details,
        ]);

        var report = h('div.report', [
            summary,
            h('div.failures', errors.map(failureReport)),
        ]);

        $progress.remove();
        $('body').prepend(report);
        try {
            console.log('closing shared websocket');
            shared_websocket.close();
        } catch (err) { console.error(err); }
        try {
            console.log('closing shared realtime');
            shared_realtime.network.disconnect();
        } catch (err) { console.error(err); }
    }, function (i, total) {
        console.log('test '+ i +' completed');
        completed++;
        Messages.assert_numberOfTestsCompleted = "{0} / {1} tests completed.";
        $progress.html('').append(h('div.report.pending.summary', [
            versionStatement(),
            h('p', [
                h('i.fa.fa-spinner.fa-pulse'),
                h('span', Messages._getKey('assert_numberOfTestsCompleted', [completed, total]))
            ])
        ]));
    });
});
