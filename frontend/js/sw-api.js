
//See an explanation of the cache strategies at https://developers.google.com/web/ilt/pwa/using-sw-precache-and-sw-toolbox#caching_strategies_with_sw-toolbox

//load data into local database

importScripts('../3rdparty/js/pouchdb.js');

self.addEventListener('fetch', function(event) {
    if (event.request.url.match(/\api\/login\/*/g)){
        event.waitUntil(
            fetch(event.request)
                .then(function (response) {
                    response.json().then(function (json) {
                        cacheFirstData(json.token);
                    });
                    return;
                })

                .catch(function() {
                return new Response("Request failed!");
            })
        );

    }

});

function cacheFirstData(token){
    fetch('/api/things?token=' + token + '&skip=0&limit=100', {mode: 'cors'})
        .then(function(response) {
            return response.json();
        })
        .then(function(json) {
            console.log(json);
            cacheThings(json);
        })
        .catch(function(error) {
            console.log('Request failed', error);
        });
}


function cacheThings(data) {
    var db = new PouchDB('things');
    db.bulkDocs(data.things);

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


