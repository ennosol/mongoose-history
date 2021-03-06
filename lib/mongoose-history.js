"use strict";

var mongoose = require('mongoose');
var hm = require('./history-model');
var deep = require('deep-diff');

module.exports = function historyPlugin(schema, options) {

    var customCollectionName  = options && options.customCollectionName;
    var customDiffAlgo = options && options.customDiffAlgo;
    var diffOnly  = options && options.diffOnly;

    // Clear all history collection from Schema
    schema.statics.historyModel = function() {
        return hm.HistoryModel(hm.historyCollectionName(this.collection.name, customCollectionName), options);
    };

    // Clear all history documents from history collection
    schema.statics.clearHistory = function(callback) {
        var History = hm.HistoryModel(hm.historyCollectionName(this.collection.name, customCollectionName), options);
        History.remove({}, function(err) {
            callback(err);
        });
    };

    // Save original data
    schema.post('init', function(next) {
        if (diffOnly) {
            var original = this.toObject();
            delete original._original;
            this._original = original;
        }
    });

    // Listen on create, update, remove
    schema.pre('save', getSaveHook({ operation: 'save' }));
    schema.pre('update', getUpdateHook({ operation: 'update' }));
    schema.pre('findOneAndUpdate', getUpdateHook({ operation: 'update' }));
    schema.pre('remove', getDeleteHook({ operation: 'remove' }));
    schema.pre('findOneAndRemove', getDeleteHook({ operation: 'remove' }));

    function getSaveHook(options) {
        return function saveHook(next) {
            options.operation = this.isNew ? 'create' : 'update';
            getSaveHistoryDoc(
                next,
                this.collection.name,
                options,
                diffOnly
                    ? getDiffData(this._original, this.toObject())
                    : getNewData(this.toObject())
            );
        }
    }

    function getUpdateHook(options) {
        return function updateHook(next) {
            var data = this._update.$set || this._update || {};
            getSaveHistoryDoc(
                next,
                this.mongooseCollection.collectionName,
                options,
                diffOnly
                    ? getDiffData(this._update._original, data)
                    : getNewData(this.toObject())
            );
        }
    }

    function getDeleteHook(options) {
        return function deleteHook(next) {
            getSaveHistoryDoc(
                next,
                this.mongooseCollection.collectionName,
                options,
                getNewData({
                    0: {
                        lhs: {
                            _id: this._conditions._id
                        },
                        kind: 'D'
                    },
                    history: {
                        user: {
                            id: global.user.id,
                            name: global.user.name.fullEmail
                        },
                        partnerId: global.user.partnerId.toString()
                    }
                })
            );
        }
    }

    function getSaveHistoryDoc(next, collection, options, data) {

        var historyDoc = {
            data: data.diff,
            created_at: new Date(),
            operation: options.operation,
            table: collection
        };

        if (typeof data.additional !== 'undefined') {
            historyDoc.additional = data.additional;
        }

        var history = new hm.HistoryModel(
            hm.historyCollectionName(collection, customCollectionName),
            options
        )(historyDoc);

        history.save(next);
    }

    function getDiffData(original, updated) {

        delete updated._original;
        var data = {};

        if (customDiffAlgo) {
            for (var k in updated) {
                var customDiff = customDiffAlgo(k, updated[k], original[k]);
                if (customDiff) {
                    data.diff[k] = customDiff.diff;
                }
            }
        } else {
            data.diff = deep.diff(original, updated);
        }

        data.diff['_id'] = updated['_id'];

        if (typeof updated.history !== 'undefined') {
            data.additional = updated.history;
        }

        return data;
    }

    function getNewData(saved) {

        var data = {
            diff: saved
        };

        if (typeof saved.history !== 'undefined') {
            data.additional = saved.history;
            delete data.diff.history;
        }

        return data;
    }

};
