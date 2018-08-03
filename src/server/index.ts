import * as akala from '@akala/server';
import { EventEmitter } from 'events';

akala.injectWithName(['$isModule'], function (isModule: akala.worker.IsModule)
{
    if (isModule('@domojs/media-kodi'))
    {
        require('./player');
        require('./scrapper');
    }
})();

