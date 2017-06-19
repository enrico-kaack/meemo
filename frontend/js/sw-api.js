
//See an explanation of the cache strategies at https://developers.google.com/web/ilt/pwa/using-sw-precache-and-sw-toolbox#caching_strategies_with_sw-toolbox

//load data into local database

importScripts('../3rdparty/js/pouchdb.js');

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


self.addEventListener('fetch', function(event) {
    if (event.request.url.match(/\api\/things*/g) && event.request.method === 'GET'){
        var params = decodeUrlForParameter(event.request.url);
        var skip = isNaN(parseInt(params.skip)) ? 0 : parseInt(params.skip);
        var limit = isNaN(parseInt(params.limit)) ? 10 : parseInt(params.limit);
        var filter = params.filter;
        if (filter === null || filter === ''){
            event.respondWith(
                getAll(skip, limit)


            );
        }else{
            //search(filter, skip, limit);
        }



    }

});

function decodeUrlForParameter(url){
    var vars = {};
    var parts = url.replace(/[?&]+([^=&]+)=([^&]*)/gi,
        function(m,key,value) {
            vars[key] = value;
        });
    console.log('params', vars);
    return vars;
}

function search(filterString, skip, limit) {
    //importScripts('../3rdparty/js/pouchdb.quick-search.js');

    //PouchDB.plugin(quick-search);
    var db = new PouchDB('things');
    db.search({
        query: filterString,
        fields: ['richContent'],
        include_docs: true
    }).then(function (result) {
        console.log(result)
    }).catch(function (err) {
        console.error(err)
    })
}


function getAll(skip, limit) {
    var db = new PouchDB('things');

    return promise = new Promise(function(resolve, reject) {
        db.allDocs({
            include_docs: true,
            skip: skip,
            limit: limit
        }).then(function (result) {
            var thingList = [];
            console.log(result)
            result.rows.forEach(function (thing, item, array) {
                thingList.push(thing.doc);
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
                    console.log('Request failed', error);
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
console.log(thing)
    db.get(thing._id).then(function(doc) {
        thing._rev = doc._rev;
        return db.put(thing);
    }).then(function(response) {
        console.log("Success updating thing", response);
    }).catch(function (err) {
        if (err.status === 404){
            db.put(thing).then(function (response) {
                console.log('Success inserting thing', response)
            }).catch(function (err) {
                console.log('Error inserting thing', err);
            });
        }
    });
}


//store the token in the indexed db, cant use local storage in service worker
function storeValue(key, value){
    var db = new PouchDB('sw-settings');
    db.get(key).then(function(doc) {
        return db.put({
            _id: key,
            _rev: doc._rev,
            value: value
        });
    }).then(function(response) {
        console.log("Success updating ", key, response);
    }).catch(function (err) {
        if (err.status === 404){
            db.put({
                _id: key,
                value: value
            }).then(function (response) {
                console.log('Success inserting',key , response)
            }).catch(function (err) {
                console.error('Error inserting ', key, err);
            });
        }
    });
}

function getStoredValue(key, callback){
    var db = new PouchDB('sw-settings');
    db.get(key).then(function(response) {
        console.log("Success loading saved ", key, response);
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


