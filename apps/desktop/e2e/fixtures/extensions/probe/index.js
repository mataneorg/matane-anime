// A hand-written extension for the e2e tests of the network layer. `getPopular` fetches whatever the
// `url` preference points at and returns what came back as the title of one item, or throws what the
// network layer threw. Preferences: url, referer, timeoutMs.
(function () {
  var pref = function (key) {
    return prefs.get(key);
  };
  var fetchOnce = function () {
    var options = { headers: {} };
    if (pref('referer')) options.headers.Referer = pref('referer');
    if (pref('timeoutMs')) options.timeoutMs = Number(pref('timeoutMs'));
    return http.get(pref('url'), options).then(function (response) {
      return {
        items: [{ url: '/probe', title: response.text.slice(0, 500) + '|' + response.status + '|' + response.url }],
        hasNextPage: false,
      };
    });
  };
  globalThis.__extension = {
    preferences: function () {
      return [
        { type: 'text', key: 'url', label: 'URL', default: '' },
        { type: 'text', key: 'referer', label: 'Referer', default: '' },
        { type: 'text', key: 'timeoutMs', label: 'Timeout', default: '' },
      ];
    },
    createSource: function () {
      return {
        baseUrl: 'http://probe.test',
        getPopular: function () {
          return fetchOnce();
        },
        // The global search asks every source the same thing; here that is whatever the `url` points at.
        search: function () {
          return fetchOnce();
        },
        getAnimeDetails: function (anime) {
          return { url: anime.url, title: anime.title, status: 'unknown' };
        },
        getEpisodes: function () {
          return [];
        },
        getStreams: function () {
          return [];
        },
      };
    },
  };
})();
