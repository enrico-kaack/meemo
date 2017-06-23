
//See an explanation of the cache strategies at https://developers.google.com/web/ilt/pwa/using-sw-precache-and-sw-toolbox#caching_strategies_with_sw-toolbox

//load data into local database

importScripts('../3rdparty/js/pouchdb.js');


function getDatabase() {
    return new PouchDB('things');
}

//intercept login request to save token
self.addEventListener('fetch', function(event) {
    if (event.request.url.match(/\api\/login\/*/g)){
        event.waitUntil(
            fetch(event.request)
                .then(function (response) {
                    response.json().then(function (json) {
                        storeValue('token', json.token);
                        fetchNewItems(json.token);
                    });
                    return;
                })

                .catch(function() {
                return new Response("Request failed!");
            })
        );

    }

});

//intercept fetch event for GET /things
self.addEventListener('fetch', function(event) {
    if (event.request.url.match(/\api\/things*/g) && event.request.method === 'GET'){
        var params = decodeUrlForParameter(event.request.url);
        var skip = isNaN(parseInt(params.skip)) ? 0 : parseInt(params.skip);
        var limit = isNaN(parseInt(params.limit)) ? 10 : parseInt(params.limit);
        var filter = params.filter;
        var archived = params.archived === undefined ? false : params.archived;

        self.navigator.isOnline ? fetchNewItems(): console.debug('not_online, cant sync');

        if (filter === undefined || filter === ''){
            event.respondWith(
                getAll(skip, limit, archived)


            );
        }else{
            event.respondWith(
                search(filter, skip, limit, archived)
            );
        }
    }

});

self.addEventListener('fetch', function(event) {
    if (event.request.url.match(/\api\/things*/g) && (event.request.method === 'POST' || event.request.method === 'PUT')){
            if (self.navigator.onLine){
                //ONLINE, execute request and put response into database
                event.waitUntil(
                    fetch(event.request)
                        .then(function (response) {
                            response.json().then(function (json) {
                                updateSingleThing(getDatabase(), json.thing);
                            });
                        })
                        .catch(function (err) {
                            console.error(err);
                        })
                );
            }else{
                //OFFLINE, schedule for later
                event.respondWith(
                    event.request.json().then(function (json) {
                        //save to database with flag 'offline'
                        json._id = generateUUID(),
                        json.offline = true;
                        if (event.request.method === 'POST'){
                            json.richContent = json.content;
                            json.createdAt = json.modifiedAt = new Date().getTime();
                        }else{
                            //PUT just update
                            json.richContent = json.richContent;
                            json.modifiedAt = new Date().getTime();
                        }


                        return updateSingleThing(getDatabase(), json);

                        //register for later sync
                        self.registration.sync.register('offline-thing-sync').then(() => {
                            console.debug('sync registred');
                        });
                    })
                );
            }
        }


});

function generateUUID() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

self.addEventListener('sync', function (event) {
    console.debug('sync event occured', event)
    if (event.tag === 'offline-thing-sync' || event.tag === 'test-tag-from-devtools') {
        event.waitUntil(uploadOffline());
    }
});

function decodeUrlForParameter(url){
    var vars = {};
    var parts = url.replace(/[?&]+([^=&]+)=([^&]*)/gi,
        function(m,key,value) {
            vars[key] = value;
        });
    console.debug('params', vars);
    return vars;
}

function search(filterString, skip, limit, archived) {
    var db = new PouchDB('things');

    return promise = new Promise(function(resolve, reject) {
        db.allDocs({
            include_docs: true,
            descending: true
        }).then(function (result) {
            var searchResult = [];
            console.debug(result)
            result.rows.forEach(function (thing, item, array) {
                if (thing.doc.richContent !== undefined && thing.doc.richContent.toLowerCase().includes(filterString.toLowerCase()) && thing.doc.archived === archived) {
                    searchResult.push(thing.doc);
                }
            });

            resolve(new Response(JSON.stringify({things: searchResult}), {
                headers: {
                    'Content-Type':'application/json'
                }
            }));
        }).catch(function (err) {
            reject(Error(err));
        });
    });
}

function getAll(skip, limit, archived) {
    var db = new PouchDB('things');
    return promise = new Promise(function(resolve, reject) {
        db.allDocs({
            include_docs: true,
            skip: skip,
            limit: limit,
            descending: true
        }).then(function (result) {
            var thingList = [];
            console.debug('result', result)
            result.rows.forEach(function (thing, item, array) {
                if (thing.doc.richContent !== undefined && thing.doc.archived === archived){
                    thingList.push(thing.doc);
                }

            });

            resolve(new Response(JSON.stringify({things: thingList}), {
                headers: {
                'Content-Type':'application/json'
            }
            }));
        }).catch(function (err) {
            reject(Error(err));
        });
    });


}

function uploadOffline(){
    //design the index
    var ddoc = {
        _id: '_design/offline_index',
        views: {
            by_offline: {
                map: function (doc) {
                    if (doc.offline === true){
                        emit(doc);
                    }
                }.toString()
            }
        }
    };
    // save it
    getDatabase().put(ddoc).then(function () {
        console.debug('Index for offline successfull applied');
        loadAllOfflineThingsFromDatabsae().then(function (list) {
            uploadOfflineModifiedThings(list);
        });

    }).catch(function (err) {
        if (err.status === 409){
            console.debug('index already created', err);
            loadAllOfflineThingsFromDatabsae().then(function (list) {
                uploadOfflineModifiedThings(list);
            });
        }else{
            console.error('error creating index for offline successfull', err);
        }

    });


}

function uploadOfflineModifiedThings(thingList) {
    console.debug('list to sync', thingList)
    var allSucceed = true;
    getStoredValue('token', function (token) {
        thingList.forEach(function (item, index, array) {
            var myHeaders = new Headers();
            myHeaders.append("Content-Type", "application/json");
            fetch('/api/things?token=' + token,
                {
                    method: 'POST',
                    headers: myHeaders,
                    body: JSON.stringify(item)
                }
            )
                .then(function (res) {
                    if (res.status === 201){
                        res.json().then(function (thing) {
                            console.debug(thing)

                                    getDatabase().put(thing.thing).then(function (response) {
                                        console.debug('Success inserting synced thing', response);

                                        //remove offline_saved file from database
                                        getDatabase().get(item._id).then(function (doc) {
                                            return getDatabase().remove(doc)
                                                .catch(function (err) {
                                                    console.error('Failed deleting offline item', err);
                                                });
                                        });

                                    }).catch(function (err) {
                                        console.error('Error inserting thing', err);
                                    });


                        });
                    }else{
                        allSucceed = false;
                    }
                })
                .catch(function (err){
                    allSucceed = false;
                    console.error('Error during background sync', err);
                });
        });
    });

}

function loadAllOfflineThingsFromDatabsae() {
    return promise = new Promise(function (resolve, reject) {
        getDatabase().query('offline_index/by_offline', {
            include_docs: true
        }).then(function (result) {

            var thingList = [];
            result.rows.forEach(function (thing, item, array) {
                    thingList.push(thing.doc);

            });
            console.debug('fetched offline modified things', thingList);
            resolve(thingList);
        }).catch(function (err) {
            console.error('Error querying offline modified documents', err);
            reject(err);
        });
    });

}

function fetchNewItems(token){
    getStoredValue('lastSync', function (lastSync) {
        getStoredValue('token', function (token) {
            fetch('/api/new?token=' + token + '&lastSync=' + lastSync, {mode: 'cors'})
                .then(function(response) {
                    return response.json();
                })
                .then(function(json) {
                    updateLocalDatabse(json.things);
                })
                .catch(function(error) {
                    console.error('Request failed', error);
                });
        });
    });

}

function updateLocalDatabse(data) {
    var db = new PouchDB('things');
    storeValue('lastSync', new Date().getTime());

    data.forEach(function (thing, index, array) {
        updateSingleThing(db, thing);
    });


}

function updateSingleThing(db, thing) {
    console.debug('Save to db', thing);
    return promise = new Promise(function (resolve, reject) {
        if (thing._id !== undefined) {
            db.get(thing._id).then(function (doc) {
                thing._rev = doc._rev;
                return db.put(thing);
            }).then(function (response) {
                console.debug("Success updating thing", response);
                resolve(new Response(JSON.stringify({thing: thing}), {
                    headers: {
                        'Content-Type':'application/json'
                    },
                    status: 201,
                    statusText: 'Created'
                }));
            }).catch(function (err) {
                if (err.status === 404) {
                        db.put(thing).then(function (response) {
                            console.debug('Success inserting thing', response)
                            resolve(new Response(JSON.stringify({thing: thing}), {
                                headers: {
                                    'Content-Type':'application/json'
                                },
                                status: 201,
                                statusText: 'Created'
                            }));
                        }).catch(function (err) {
                            console.error('Error inserting thing', err);
                        });
                } else {
                    console.error(err);
                }
            });
        } else {
            db.post(thing).then(function (response) {
                console.debug('Success inserting thing with auto generated id', response);
                resolve(new Response(JSON.stringify({thing: thing}), {
                    headers: {
                        'Content-Type':'application/json'
                    },
                    status: 201,
                    statusText: 'Created'
                }));
            }).catch(function (err) {
                console.error('Error inserting thing with auto generated id', err);
            });
        }
    });
}

function saveNewItem(data){
    var db = new PouchDB('things');
    return new Promise(function(resolve, reject) {

    });
}


//store the token in the indexed db, cant use local storage in service worker
function storeValue(key, value){
    console.debug('store value', key, value)
    var db = new PouchDB('sw-settings');
    db.get(key).then(function(doc) {
        return db.put({
            _id: key,
            _rev: doc._rev,
            value: value
        });
    }).then(function(response) {
        console.debug("Success updating ", key, response);
    }).catch(function (err) {
        if (err.status === 404){
            db.put({
                _id: key,
                value: value
            }).then(function (response) {
                console.debug('Success inserting',key , response)
            }).catch(function (err) {
                console.error('Error inserting ', key, err);
            });
        }
    });
}

function getStoredValue(key, callback){
    var db = new PouchDB('sw-settings');
    db.get(key).then(function(response) {
        console.debug("Success loading saved ", key, response);
        callback(response.value);
    }).catch(function (err) {
        console.error('Error loading saved', key, err);
        callback(null);
    });
}


//invalidate/delete cache on logout
toolbox.router.get('/api/logout', function (event) {
//toolbox.uncache('*/api/*'); //TODO: specify which cache needs to be cleared
event.respondWith(toolbox.networkOnly(event.request));

});



//use fastest strategy (make sure the cache is updated by the network version if online) for profile, settings
//best performance on slow network, having outdated data is not bad
toolbox.router.get('/api/profile', toolbox.fastest);
toolbox.router.get('/api/settings', toolbox.fastest);

toolbox.router.get('/api/tags', toolbox.networkFirst);


//use the cache first strategy (cache first, network fallback) for all images
//images are unlikely to change their content, so there is no need to request an image if it has been cached before
toolbox.router.get(/.(jpg|.jpeg|.png)$/, toolbox.cacheFirst);


