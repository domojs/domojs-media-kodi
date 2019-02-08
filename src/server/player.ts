import * as akala from '@akala/server';
import * as media from '@domojs/media';
import { Client, Connection } from '@akala/json-rpc-ws'
import * as fs from 'fs';
import * as sd from '@domojs/service-discovery';

var debug = akala.logger;

type PlayerProperties = 'position' | 'percentage' | 'repeat' | 'canseek' | 'time' | 'totaltime' | 'speed' | 'playlistid';
type ItemProperties = 'title' | 'artist' | 'albumartist' | 'fanart' | 'plot' | 'season' | 'episode' | 'thumbnail' | 'file' | 'art';
type Item = { [key in ItemProperties]: any };

var KodiPlayerApi = new akala.Api()
    .clientToServer<void, { playerid: string }[]>()({ GetActivePlayers: true })
    .clientToServerOneWay<{ playerid: string }>()({ GoNext: true, GoPrevious: true, Stop: true })
    .clientToServer<{ playerid: string }, { speed: number }>()({ PlayPause: true })
    .clientToServerOneWay<{ item: { file: string } }>()({ Open: true })
    .clientToServer<{ playerid: string, properties: PlayerProperties[] }, { [key in PlayerProperties]: any }>()({ GetProperties: true })
    .clientToServer<{ playerid: string, properties: ItemProperties[] }, { item: Item }>()({ GetItem: true })


var KodiPlaylistApi = new akala.Api()
    .clientToServer<void, { items: { type: string, playlistid: number }[] }>()({ GetPlaylists: true })
    .clientToServerOneWay<{ playlistid: number, item: { file: string } }>()({ Add: true })
    .clientToServer<{ playlistid: string, properties: ItemProperties[] }, { items: Item[] }>()({ GetItems: true })

type KodiPlayerProxy = akala.api.ServerProxy<typeof KodiPlayerApi>;

type KodiPlaylistProxy = akala.api.ServerProxy<typeof KodiPlaylistApi>;

type KodiService = sd.Service & { id: string, referer: { address: string }, port: number };

akala.injectWithNameAsync(['$agent.api/zeroconf', '$agent.api/media'], function (zeroconfClient, mediaClient)
{
    var kodis: { [id: string]: PromiseLike<{ Player: KodiPlayerProxy, Playlist: KodiPlaylistProxy }> } = {};
    var timers: { [id: string]: NodeJS.Timer } = {};
    function startTimer(id: string)
    {
        if (timers[id])
            return;
        timers[id] = setInterval(function ()
        {
            client.status({ target: id });
        }, 1000)
    }

    function stopTimer(id: string)
    {
        if (timers[id])
            clearInterval(timers[id]);
        timers[id] = null;
    }


    var client = akala.api.jsonrpcws(media.player).createClient(mediaClient, {
        mute(p)
        {

        },
        async status(p: { target: string })
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null)
            if (players.length > 0)
            {
                debug.verbose(players);
                var player = await kodi.Player.GetProperties({ playerid: players[0].playerid, properties: ['position', 'percentage', 'repeat', 'canseek', 'time', 'totaltime', 'speed'] });
                debug.verbose(player);
                return client.$proxy().status({
                    identity: p.target,
                    state: player.speed ? 'playing' : 'paused',
                    position: player.percentage / 100,
                    time: player.time.seconds + 60 * player.time.minutes + 3600 * player.time.hours,
                    length: player.totaltime.seconds + 60 * player.totaltime.minutes + 3600 * player.totaltime.hours,
                });
            }
            else
            {
                client.$proxy().status({
                    identity: p.target,
                    state: 'stopped',
                });
                stopTimer(p.target);
            }

        },
        async playlist(p: { target: string })
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null);
            if (players.length > 0)
            {
                debug.log(players);
                var properties = await kodi.Player.GetProperties({ playerid: players[0].playerid, properties: ['playlistid', 'speed'] });
                if (typeof (properties.playlistid) != 'undefined')
                {
                    var item: { item: Item & { current?: boolean } } = await kodi.Player.GetItem({ playerid: players[0].playerid, properties: ['title', 'artist', 'albumartist', 'fanart', 'plot', 'season', 'episode', 'thumbnail', 'file', 'art'] })
                    {
                        akala.extend(item.item, { current: true });
                        var playlist = await kodi.Playlist.GetItems({ playlistid: properties.playlistid, properties: ['title', 'artist', 'albumartist', 'fanart', 'plot', 'season', 'episode', 'thumbnail', 'file', 'art'] })
                        debug.verbose(playlist);
                        if (playlist && !playlist.items)
                            playlist.items = [item.item]
                        else
                            playlist.items.unshift(item.item);
                        debug.verbose(playlist.items);
                        if (properties.speed > 0)
                            startTimer(p.target);
                        if (playlist && playlist.items)
                            client.$proxy().playlist({
                                identity: p.target, playlist: akala.map(playlist.items, function (media: Item & { current?: boolean })
                                {
                                    return { url: media.file.replace(/smb:\/\//, 'file://///'), current: media.current };
                                })
                            });
                    }
                }
            }
        },
        async next(p)
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null);
            if (players.length > 0)
            {
                debug.verbose(players);
                kodi.Player.GoNext({ playerid: players[0].playerid })
            }
        },
        async previous(p)
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null);
            if (players.length > 0)
            {
                debug.verbose(players);
                kodi.Player.GoPrevious({ playerid: players[0].playerid })
            }
        },
        async pause(p)
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null);
            if (players.length > 0)
            {
                debug.verbose(players);
                var status = await kodi.Player.PlayPause({ playerid: players[0].playerid });
                if (status.speed)
                    startTimer(p.target);
                else
                    stopTimer(p.target);
            }
        },
        async stop(p)
        {
            var kodi = await kodis[p.target];
            var players = await kodi.Player.GetActivePlayers(null);
            if (players.length > 0)
            {
                debug.verbose(players);
                await kodi.Player.Stop({ playerid: players[0].playerid });
                stopTimer(p.target);
            }
        },
        async play(p)
        {
            var kodi = await kodis[p.target];
            var media = p.media;
            debug.info(media);
            if (typeof (media) != 'undefined')
            {
                if (!media || isNaN(Number(media.path)))
                {
                    media.path = decodeURIComponent(media.path);
                    media.path = media.path.replace(/file:\/\/\/\/\//, 'smb://');
                    debug.verbose(media);
                    var result = await kodi.Playlist.GetPlaylists(null);
                    debug.verbose(result);
                    var mediaType = media.id.substring('media:'.length, media.id.indexOf(':', 'media:'.length));
                    debug.verbose(mediaType);
                    if (result && result.items)
                    {
                        var playlist = akala.grep(result.items, function (e)
                        {
                            return e.type == mediaType;
                        })[0];
                        if (typeof (playlist) != 'undefined')
                        {
                            await kodi.Playlist.Add({ playlistid: playlist.playlistid, item: { file: media.path } });
                            startTimer(p.target);
                        }
                    }
                    else
                    {
                        await kodi.Player.Open({ item: { file: media.path } });
                        startTimer(p.target);
                    }
                }
                else
                {
                    throw new Error('Not implemented')
                }
            }
            else
                this.pause();
        }
    });
    akala.api.jsonrpcws(sd.meta).createClient(zeroconfClient, {
        add: function (kodiService: KodiService)
        {
            kodis[kodiService.id] = new Promise((resolve, reject) =>
            {
                var kodi = new Client();

                kodi.connect('ws://' + kodiService.referer.address + ':' + kodiService.port + '/jsonrpc', function connected(err)
                {
                    if (err)
                    {
                        debug.error(err);
                        reject(err);
                    }
                    debug.log('connected to ' + kodiService.name);

                    kodi.send('JSONRPC.Introspect', [], async function (error, reply)
                    {
                        if (error)
                        {
                            debug.error(error);
                            reject(error);
                        }
                        else
                        {
                            akala.each(reply['methods'], function (m, i)
                            {
                                var ns = (i as string).split('.');
                                if (typeof (kodi[ns[0]]) == 'undefined')
                                    kodi[ns[0]] = {};
                                kodi[ns[0]][ns[1]] = function (params)
                                {
                                    return new Promise<any>((resolve, reject) =>
                                    {
                                        if (!kodi.isConnected())
                                        {
                                            client.$proxy().unregisterPlayer({ identity: kodiService.id, name: kodiService.name })
                                            reject(new Error('Not connected'));
                                            return;
                                        }

                                        akala.each(m.params, function (value)
                                        {
                                            if (value.required && typeof (params[value.name]) == 'undefined')
                                            {
                                                throw JSON.stringify(params) + ' is missing the required param ' + value.name + ' for ' + ns[1];
                                            }
                                        });
                                        akala.logger.verbose('calling ' + i, JSON.stringify(params));
                                        kodi.send(i as string, params, (error, result) =>
                                        {
                                            if (error)
                                                reject(error);
                                            else
                                                resolve(result);
                                        });
                                    });
                                }
                            })
                            akala.each(reply['notifications'], function (i, m)
                            {
                                var ns = i.split('.');
                                if (typeof (kodi[ns[0]]) == 'undefined')
                                    kodi[ns[0]] = {};
                                kodi[ns[0]][ns[1]] = function (callback)
                                {
                                    if (typeof (callback) == 'undefined')
                                    {
                                        throw 'callback is missing for ' + ns[1];
                                    }
                                    akala.logger.info('monitoring ' + i, JSON.stringify(i));
                                    kodi.expose(i, callback);
                                }
                            })
                            debug('kodi client built');
                            await kodi['JSONRPC'].SetConfiguration({ notifications: { gui: false, system: true, player: true, audiolibrary: false, other: false, videolibrary: false } });
                            kodi['Player'].OnPause(function ()
                            {
                                debug('OnPause')
                                client.status({ target: kodiService.id });
                                stopTimer(kodiService.id);
                            });
                            kodi['Player'].OnPlay(function ()
                            {
                                debug('OnPlay')
                                client.status({ target: kodiService.id });
                                client.playlist({ target: kodiService.id });
                                startTimer(kodiService.id);
                            });
                            kodi['Player'].OnSeek(function ()
                            {
                                debug('OnSeek')
                                client.status({ target: kodiService.id });
                            });
                            kodi['Player'].OnPropertyChanged(function ()
                            {
                                debug('OnPropertyChanged')
                                client.status({ target: kodiService.id });
                            });
                            kodi['Player'].OnStop(function ()
                            {
                                debug('OnStop')
                                client.status({ target: kodiService.id });
                                stopTimer(kodiService.id);
                            });

                            resolve(kodi as any);
                        }
                    });
                });
            })
        },
        delete(service: KodiService)
        {
            client.$proxy().unregisterPlayer({ identity: service.id, name: service.name });
        }
    }).$proxy().notify({ type: 'xmbc-jsonrpc' });

});