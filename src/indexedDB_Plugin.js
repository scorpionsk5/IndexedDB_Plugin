(function ($) {
    var getDefaultConfig = function () {
        return {
            primaryKeyField: 'Record_ID',
            messageHandler: function (msg) {
                console.log(msg);
            },
            recordName: 'Data'
        };
    },
        date_diff_indays = function (date1, date2) {
            dt1 = new Date(date1);
            dt2 = new Date(date2);
            return Math.floor((Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate()) - Date.UTC(dt1.getFullYear(), dt1.getMonth(), dt1.getDate())) / (1000 * 60 * 60 * 24));
        },
        indexedDBManagerInstancePool = {},

        asyncLoop = function (handler, timeOut) {
            var loop = window.setInterval(function () {
                if (handler() === false) {
                    clearInterval(loop);
                };
            }, timeOut || 50);
        },

        parsePath = function (tablePath) {
            var pathArray = tablePath.split('/'),
                pathDetails = {};

            pathArray.length - 1 >= 0 && (pathDetails.tableName = pathArray[pathArray.length - 1]);
            pathArray.length - 2 >= 0 && (pathDetails.dbName = pathArray[pathArray.length - 2]);

            return pathDetails;
        },

        parseName = function (name) {
            var pathArray = name.split('/'),
                pathDetails = {};

            pathArray.length - 1 >= 0 && (pathDetails.recordName = pathArray[pathArray.length - 1]);
            pathArray.length - 2 >= 0 && (pathDetails.recordName = pathArray[pathArray.length - 2], pathDetails.key = pathArray[pathArray.length - 1]);

            return pathDetails;
        },

        getBaseModel = function () {
            var me = this;
            return {
                Record_ID: me.options.recordName,
                validFor: 0,    // in days. set 0 for disable auto expire.
                createdDate: Date()
            }
        };

    /* IndexedDB manager class */
    IndexedDBManager = function (options) {
        var me = this,
            readyState = false;
        me.options = options;
        me.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        me.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
        me.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
        if (!me.indexedDB) {
            me.options.messageHandler("Your browser doesn't support a stable version of IndexedDB.");
        };
        var request = me.indexedDB.open(me.options.dbName);
        request.onerror = function (e) {
            me.options.messageHandler(e.target.errorCode);
        };
        request.onsuccess = function (e) {
            me.db = event.target.result;
            me.removeExpiredRecords();
            readyState = true;
        };
        request.onupgradeneeded = function (e) {
            var db = e.target.result;
            db.createObjectStore(me.options.tableName, { keyPath: me.options.primaryKeyField });
            readyState = true;
        };

        me.isIndexedDBManagerReady = function () {
            return readyState;
        };
    };

    IndexedDBManager.prototype.get = function (key) {
        var me = this,
            def = $.Deferred(),
            transaction = me.db.transaction([me.options.tableName]),
            objectStore = transaction.objectStore(me.options.tableName),
            recordPath = parseName(key),
            request = objectStore.get(recordPath.recordName || me.options.recordName);

        request.onerror = function (e) {
            me.options.messageHandler("Unable to retrieve daa from database! Error: " + e.target.errorCode);
            def.reject(e.target.errorCode);
        };

        request.onsuccess = function (e) {
            def.resolve(request.result ? (recordPath.key ? request.result[recordPath.key] : request.result) : {});
        };

        return def.promise();
    };

    IndexedDBManager.prototype.getAll = function () {
        var me = this,
            def = $.Deferred(),
            objectStore = me.db.transaction(me.options.tableName).objectStore(me.options.tableName),
            result = [];

        objectStore.openCursor().onsuccess = function (e) {
            var cursor = e.target.result;

            if (cursor) {
                result.push({ Name: cursor.key, Value: cursor.value });
                cursor.continue();
            }
            else {
                def.resolve(result);
            };
        };

        return def.promise();
    };

    IndexedDBManager.prototype.add = function (name, data) {
        var me = this,
            parsedName = parseName(name)
        def = $.Deferred();

        me.get(parsedName.recordName).done(function (res) {
            var obj = {},
                request;
            obj[me.options.primaryKeyField] = parsedName.recordName;
            request = me.db.transaction([me.options.tableName], "readwrite")
            .objectStore(me.options.tableName)
            .put($.extend(true, {}, getBaseModel.call(me), res, data, parsedName.key ? {} : obj));

            request.onsuccess = function (e) {
                def.resolve("Record successfully added.");
            };

            request.onerror = function (e) {
                me.options.messageHandler("Unable to add data\r\nRecord aready exist in your database! ");
                def.reject(e.target.errorCode);
            }
        });

        return def.promise();
    };

    IndexedDBManager.prototype.remove = function (key) {
        var me = this,
            def = $.Deferred(),
            request = me.db.transaction([me.options.tableName], "readwrite")
                .objectStore(me.options.tableName)
                .delete(key);

        request.onsuccess = function (e) {
            def.resolve(key + " entry has been removed from your database.");
        };

        return def.promise();
    };

    IndexedDBManager.prototype.clear = function () {
        var me = this,
            def = $.Deferred(),
            request = me.db.transaction([me.options.tableName], "readwrite")
                .objectStore(me.options.tableName).clear();
        request.onsuccess = function (e) {
            def.resolve("All entries has been cleared from your database.");
        };
        request.onerror = function () {
            def.reject("");
        };

        return def.promise();
    };

    IndexedDBManager.prototype.deleteDB = function () {
        var me = this,
            def = $.Deferred(),
            deleteRequest,
            msg = "";

        me.db.close();
        deleteRequest = me.indexedDB.deleteDatabase(me.options.dbName);
        deleteRequest.onsuccess = function () {
            msg = "Deleted database successfully";
            me.options.messageHandler(msg);
            def.resolve(msg);
        };
        deleteRequest.onerror = function () {
            msg = "Couldn't delete database";
            me.options.messageHandler(msg);
            def.reject(msg);
        };
        deleteRequest.onblocked = function () {
            msg = "Couldn't delete database due to the operation being blocked";
            me.options.messageHandler(msg);
            def.reject(msg);
        };

        return def.promise();
    };

    IndexedDBManager.prototype.removeExpiredRecords = function () {
        var me = this,
            recordsToBeRemoved = [];

        me.getAll().done(function (result) {
            $.each(result, function () {
                if (this.Value.validFor > 0 && this.Value.validFor <= date_diff_indays(Date(), this.Value.createdDate)) {
                    me.remove(this.Name);
                };
            });
        });
    };

    /* Create jQuery plugin. */
    $.indexedDB = function (name, value, options) {
        var data = {},
            def = $.Deferred(),
            baseOptions = $.extend(true, {}, { tablePath: 'NewDataBase/DataTable' }, options || {}),
            indexedDBManagerInstance = null,
            tableId = baseOptions.tablePath.replace('/', '_'),
            namePath = parseName(name);


        if (!indexedDBManagerInstancePool[tableId]) {
            indexedDBManagerInstancePool[tableId] = new IndexedDBManager($.extend(true, {}, baseOptions, getDefaultConfig(), parsePath(baseOptions.tablePath), namePath));
        };

        indexedDBManagerInstance = indexedDBManagerInstancePool[tableId];

        asyncLoop(function () {
            try {
                if (indexedDBManagerInstance.isIndexedDBManagerReady()) {
                    if (value) {
                        namePath.key ? (data[namePath.key] = value) : (data = value);
                        indexedDBManagerInstance.add(name, data);
                    }
                    else {
                        indexedDBManagerInstance.get(name).done(function (result) {
                            def.resolve(result);
                        });
                    };

                    return false;
                };
            } catch (e) {
                return false;
            }

        });

        return def.promise();
    };

    $.deleteIndexedDB = function (dbName) {
        var data = {},
            def = $.Deferred(),
            baseOptions = $.extend(true, {}, { tablePath: dbName || 'NewDataBase/DataTable' }),
            indexedDBManagerInstance = null,
            tableId = baseOptions.tablePath.replace('/', '_');


        if (!indexedDBManagerInstancePool[tableId]) {
            (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB).deleteDatabase(parsePath(baseOptions.tablePath).dbName);
        };

        indexedDBManagerInstance = indexedDBManagerInstancePool[tableId];

        asyncLoop(function () {
            try {
                if (indexedDBManagerInstance.isIndexedDBManagerReady()) {
                    indexedDBManagerInstance.deleteDB().done(function () {
                        delete indexedDBManagerInstancePool[tableId];
                    });
                };

                return false;
            }
            catch (e) {
                return false;
            }
        });
    };

})(jQuery);