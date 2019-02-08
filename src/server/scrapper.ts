import * as akala from '@akala/server';
import * as media from '@domojs/media';
import { Client, Connection } from '@akala/json-rpc-ws'
import * as fs from 'fs';

akala.injectWithNameAsync(['$agent.api/media'], function (client: Client<Connection>)
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
});