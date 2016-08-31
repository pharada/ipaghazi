'use strict';

function APIError(rsp) {
    if (!(this instanceof APIError))
        return new APIError(rsp);
    this.rsp = rsp;
}
APIError.prototype = Object.create(Error.prototype);
APIError.prototype.toString = function () {
    return "[API error: " + this.rsp.toString() + "]";
};

function lexSort(a, b) {
    function arrsort(ax, bx) {
        return (!ax.length && !bx.length ? 0 :
                !ax.length ? -1 :
                !bx.length ? 1 :
                compare(ax[0], bx[0]) || arrsort(ax.slice(1), bx.slice(1)));
    }
    function split(s) {
        return s.match(/[0-9]+|[^0-9]+/g).map(function (x) {
            return /^[0-9]+$/.test(x) ? parseInt(x, 10) : x;
        });
    }
    function compare(x, y) {
        return (x === y ? 0 :
                typeof x == typeof y ? (x < y ? -1 : 1) :
                x.toString() < y.toString() ? -1 :
                x.toString () > y.toString() ? 1 :
                0);
    }
    return arrsort(split(a), split(b));
}

angular.module('ipaghazi', ['ngRoute']).service('API', function ($http, $httpParamSerializer, $location) {
    this.getApps = function (succ, fail) {
        return $http.get('api/app').then(function (rsp) {
            succ(rsp.data.apps);
        }, function (rsp) {
            fail(new APIError(rsp));
        });
    };
    this.getAppRefs = function (app, succ, fail) {
        return $http.get('api/app/' + app).then(function (rsp) {
            succ(rsp.data.refs);
        }, function (rsp) {
            fail(new APIError(rsp));
        });
    };
    this.getRefBuilds = function (app, reftype, ref, succ, fail) {
        return $http.get('api/app/' + app + '/' + reftype + '/' + ref).then(function (rsp) {
            succ(rsp.data.builds);
        }, function (rsp) {
            fail(new APIError(rsp));
        });
    };
    this.getBuild = function (id, succ, fail) {
        return $http.get('api/build/' + id).then(function (rsp) {
            succ(rsp.data);
        }, function (rsp) {
            fail(new APIError(rsp));
        });
    };
    this.manifestForBuild = function (build) {
        var url = $location.absUrl().split('#')[0].split('?')[0]
            .replace(/\/*$/, '') + '/api/build/' + build + '/manifest';
        return 'itms-services://?' + $httpParamSerializer({action: 'download-manifest', url: url});
    };
}).controller('MainController', function ($scope, API, Top) {
    Top.topScope.title = "Apps";
    API.getApps(function (apps) {
        $scope.apps = apps;
    }, function (err) {
        $scope.error = err;
    });
}).controller('AppController', function ($scope, $routeParams, API, Top) {
    Top.topScope.title = $routeParams.app;
    $scope.app = $routeParams.app;
    API.getAppRefs($routeParams.app, function (refs) {
        var tags = [];
        $scope.tags = [];
        refs.tag.forEach(function (t) {
            API.getRefBuilds($routeParams.app, 'tag', t, function (builds) {
                if (builds.length) {
                    tags.push({name: t, manifest: API.manifestForBuild(builds[0])});
                    if (tags.length == refs.tag.length) {
                        console.log(tags[0]);
                        $scope.tags = tags.slice().sort(function (a, b) {return lexSort(a.name, b.name);}).reverse();
                    }
                }
            }, function (err) {
                $scope.error = $scope.error || err;
            });
        });
        $scope.branches = refs.branch;
    }, function (err) {
        $scope.error = err;
    });
}).controller('RefController', function ($scope, $routeParams, API, Top) {
    Top.topScope.title = $routeParams.app + ': ' + $routeParams.ref;
    $scope.app = $routeParams.app;
    $scope.reftype = $routeParams.reftype;
    $scope.ref = $routeParams.ref;
    API.getRefBuilds($routeParams.app, $routeParams.reftype, $routeParams.ref, function (ids) {
        $scope.builds = [];
        var builds = [];
        ids.forEach(function (id) {
            API.getBuild(id, function (build) {
                builds.push(build);
                if (builds.length == ids.length) {
                    $scope.builds = builds.slice().sort(function (a, b) {
                        var da = new Date(a.date);
                        var db = new Date(b.date);
                        return da < db ? -1 : da > db ? 1 : 0;n
                    }).reverse().map(function (x) {
                        return {date: x.date, manifest: API.manifestForBuild(id)};
                    });
                }
            }, function (err) {
                $scope.error = $scope.error || err;
            });
        });
    }, function (err) {
        $scope.error = err;
    });
}).service('Top', function () {}).controller('TopController', function ($scope, Top) {
    Top.topScope = $scope;
}).config(function ($routeProvider, $compileProvider) {
    $routeProvider.when('/', {
        templateUrl: 'main.html',
        controller: 'MainController',
    }).when('/:app', {
        templateUrl: 'app.html',
        controller: 'AppController',
    }).when('/:app/:reftype/:ref', {
        templateUrl: 'ref.html',
        controller: 'RefController',
    });
    $compileProvider.aHrefSanitizationWhitelist(/^(https?|itms-services):/);
});
