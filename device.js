deviceTypes[ 'kodi' ] = {
    name:'kodi',
    onChange:function(){
        return 'dynamic';
    },
    onServerSave: function( body, device ) {
        $.io.on( 'connection', function( socket ) {

            var identity = { id: socket.id };
            var playlistId = 'media:playlist:' + identity.id;
            var mrl;
            var markedAsRead = false;
            var device = false;
            //player discovery
            socket.on( 'whoisaplayer', function( message, callback ) {
                console.log( 'looking for players' );
                console.log( findClientsSocketByRoomId( 'iamaplayer' ).length )
                $.io.sockets.emit( 'whoisaplayer', { replyTo: identity.id, ts: Number( new Date() ) });
            });
            socket.on( 'iamaplayer', function( message, callback ) {
                identity.name = message.identity;
                console.log( identity );
                if( message.replyTo ) {
                    $.emitTo( 'iamaplayer', message.replyTo, identity );
                }
                else {
                    var cmd = function( cmd, args ) {
                        return function( value, callback ) {
                            if( value )
                                if( typeof ( args ) != 'undefined' )
                                    args.push( value );
                                else
                                    args = [ value ];
                            socket.emit( 'player.command', { name: cmd, args: args || [] });
                            if( callback )
                                callback( 200 );
                        }
                    }
                    $.io.sockets.emit( 'iamaplayer', identity );

                    $.device( device = {
                        name: identity.name, type: 'player', commands: {
                            pause: cmd( 'pause' ),
                            stop: cmd( 'stop' ),
                            next: cmd( 'next' ),
                            previous: cmd( 'previous' ),
                            fullscreen: cmd( 'fullscreen' ),
                            off: cmd( 'shutdown' ),
                        }, subdevices: [
                            {
                                name: "volume",
                                type: 'analogic',
                                category: 'actuator',
                                /*status:function(callback)
                                {
                                    var status={};
                                    send('?V', device.name, function(error, result){
                                        callback({state:/[0-9]+/.exec(result)*100/185});
                                    });
                                },*/
                                commands:
                                {
                                    'up': cmd( 'volume', [ '+5' ] ),
                                    'down': cmd( 'volume', [ '-5' ] ),
                                    'set': cmd( 'volume' )
                                },
                            },
                        ]
                    });
                }
            });

            socket.on( 'disconnect', function() {
                console.log( 'notifying death of ' + identity.id );
                $.io.sockets.emit( 'iamnotaplayer', identity );
                if( device ) {
                    device.remove();
                }
                $.db.del( playlistId, playlistId + ':ids', function( err ) {
                    if( err )
                        console.log( err );
                });
            });

            // proxying playlist
            socket.on( 'player.playlist', function( message ) {

                var args = [ playlistId ];
                $.each( message, function( index, item ) {
                    args.push( item.uri );
                    if( ( !mrl || mrl != item.uri ) && item.current == 'current' ) {
                        mrl = item.uri;
                        markedAsRead = false;
                        console.log( 'current item is ' + mrl );
                        socket.emit( 'player.command', { name: 'art', args: [] });
                        $.db.get( mrl, function( err, id ) {
                            if( id )
                                $.db.multi()
                                    .set( id.substr( 0, id.indexOf( ':', id.indexOf( ':' ) + 1 ) ) + ':lastPlayed', id )
                                    .exec( $.noop )
                        });
                    }
                });
                $.db.del( playlistId, playlistId + ':ids', function() {
                    $.db.rpush( args, function() {
                        $.db.sort( playlistId, 'BY', 'NOSORT', 'GET', '*', 'ALPHA', function( err, replies ) {
                            if( err )
                                console.log( err );
                            if( replies.length == 0 )
                                return $.emitTo( 'player.playlist', 'player-' + identity.id, [] );
                            replies.unshift( playlistId + ':ids' )
                            $.db.rpush( replies, function( err, replies ) {
                                if( err )
                                    console.log( err );
                                var columns = [ 'displayName', 'path', 'id' ];
                                args = [ playlistId + ':ids', 'BY', 'NOSORT' ];
                                for( var c in columns ) {
                                    args.push( 'GET' );
                                    if( columns[ c ] == 'id' )
                                        args.push( '#' );
                                    else
                                        args.push( '*->' + columns[ c ] );
                                }
                                args.push( 'ALPHA' );
                                $.db.sort( args, function( err, replies ) {
                                    var result = [];
                                    for( var i = 0;i < replies.length; ) {
                                        var item = {};
                                        if( message[ Math.floor( i / columns.length ) ] )
                                            item.listId = message[ Math.floor( i / columns.length ) ].id;
                                        for( var c in columns ) {
                                            item[ columns[ c ] ] = replies[ i++ ];

                                        }
                                        if( item.path == mrl )
                                            item.active = true;
                                        result.push( item );
                                    }
                                    $.emitTo( 'player.playlist', 'player-' + identity.id, result );
                                });
                            });
                        });
                    });
                });
            });


            // proxying status
            socket.on( 'player.status', function( message ) {
                if( !markedAsRead && message.time / message.length > 0.5 ) {
                    markedAsRead = true;
                    $.db.get( mrl, function( err, id ) {
                        if( err ) {
                            markedAsRead = false;
                            console.log( err );
                            return;
                        }
                        $.db.hget( id, 'index', function( err, index ) {
                            if( err ) {
                                markedAsRead = false;
                                console.log( err );
                                return;
                            }
                            $.db.multi().
                                hset( id, 'lastread', new Date().toISOString() ).
                                hset( index, 'lastread', new Date().toISOString() ).
                                hincrby( id, 'readcount', 1 ).
                                exec( function( err ) {
                                    if( err ) {
                                        markedAsRead = false;
                                        console.log( err );
                                    }
                                });
                        })
                    });
                }
                $.emitTo( 'player.status', 'player-' + identity.id, message );
            });

            var getArt = require( './controllers/api/library.js' ).getArt;

            // proxying art
            socket.on( 'player.art', function( message ) {
                var callback = function( img ) {
                    $.emitTo( 'player.art', 'player-' + identity.id, 'data:image/jpeg;base64,' + img );
                };

                //console.log(message);
                if( message.length == 0 || message.toString( 'ascii' ) != 'Error' ) {
                    console.log( 'looking for art' );
                    $.db.get( mrl, function( err, id ) {
                        getArt( $.db.another(), id, callback );
                    });
                }
                else
                    callback( message );
            });

            // proxying commands
            socket.on( 'player.command', function( message ) {
                console.log( 'sending command ' + message.command + ' to ' + message.to );
                $.emitTo( 'player.command', message.to, message.command );
            });
        });
    }
};