import * as akala from '@akala/server';
import { Client, Connection } from '@akala/json-rpc-ws'
import { EventEmitter } from 'events';
import * as media from '@domojs/media';
import * as fs from 'fs';

akala.injectWithName(['$isModule', '$master', '$worker'], function (isModule: akala.worker.IsModule, master: akala.worker.MasterRegistration, worker: EventEmitter)
{
    if (isModule('@domojs/cron'))
    {
        worker.on('ready', function ()
        {
            // Called when all modules have been initialized
        });
        master(__filename, './master');

        // akala.injectWithNameAsync([AssetRegistration.name], function (va: AssetRegistration)
        // {
        //     va.register('/js/tiles.js', require.resolve('../tile'));
        //     va.register('/js/routes.js', require.resolve('../routes'));
        // });

    }
})();

akala.injectWithNameAsync(['$isModule', '$config.@domojs/media-kodi', '$agent.media'], function (isModule: akala.worker.IsModule, config: any, client: Client<Connection>)
{
    if (isModule('@domojs/media-kodi'))
    {
        var s = akala.api.jsonrpcws(media.scrapper).createClient(client, {
            scrap: function (media: media.TVShow | media.Movie)
            {
                switch (media.subType)
                {
                    case 'movie':
                        fs.writeFile(media.path + '.nfo', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <movie>
                        <title>${media.name}</title>
                        <sorttitle>${media.displayName}</sorttitle>
                        <thumb aspect="poster">${media.cover}</thumb>
                    </movie>`, 'utf8', function (err)
                            {
                                if (err)
                                    akala.logger.error(err);
                            });

                        break;
                    case 'tvshow':

                        fs.writeFile(media.path + '.nfo', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <episodedetails>
                        <title>${media.name}</title>
                        <sorttitle>${media.displayName}</sorttitle>
                        <thumb aspect="poster">${media.cover}</thumb>
                        <season>${media.season}</season>
                        <episode>${media.episode}</episode>
                    </episodedetails>`, 'utf8', function (err)
                            {
                                if (err)
                                    akala.logger.error(err);
                            });
                        break;
                }

                return media;

            }
        }).$proxy();
        s.register({ type: 'video', priority: 20 });
    }
});