/* See license.txt for terms of usage */

define([
    "firebug/lib/object",
    "firebug/lib/options",
    "firebug/debugger/sourceFile",
    "firebug/debugger/debugProtocolTypes",
    "firebug/debugger/threadClient",
    "firebug/debugger/breakpointClient",
],
function (Obj, Options, SourceFile, DebugProtocolTypes, ThreadClient, BreakpointClient) {

// ********************************************************************************************* //
// Constants and Services

var Cu = Components.utils;

Cu["import"]("resource:///modules/devtools/dbg-client.jsm");
Cu["import"]("resource:///modules/devtools/dbg-server.jsm");

// ********************************************************************************************* //
// Debugger Client

function DebuggerClient(connection)
{
    this.connection = connection;

    this.threadClients = {};

    this.onTabNavigatedListener = this.onTabNavigated.bind(this);
    this.onTabDetachedListener = this.onTabDetached.bind(this);
}

DebuggerClient.prototype = Obj.extend(Object,
{
    dispatchName: "DebuggerClient",

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    initialize: function(context, doc)
    {
    },

    destroy: function(state)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Connection

    attach: function(callback)
    {
        this.connection.addListener("tabNavigated", this.onTabNavigatedListener);
        this.connection.addListener("tabDetached", this.onTabDetachedListener);

        var self = this;
        this.connection.listTabs(function(response)
        {
            var tab = response.tabs[response.selected];
            self.startDebugging(tab);
        });
    },

    detach: function(callback)
    {
        FBTrace.sysout("debuggerClient.detach;", this);

        this.connection.removeListener("tabNavigated", this.onTabNavigatedListener);
        this.connection.removeListener("tabDetached", this.onTabDetachedListener);

        if (!this.activeThread)
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("debuggerClient.detach; ERROR activeThread not defined?");
            return;
        }

        var self = this;
        this.activeThread.detach(function()
        {
            self.connection.detachTab(function()
            {
                callback();
            });
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Calbacks

    onTabNavigated: function()
    {
        FBTrace.sysout("debuggerClient.onTabNavigated;");

        var self = this;
        this.detach(function()
        {
            self.attach();
        });
    },

    onTabDetached: function()
    {
        FBTrace.sysout("debuggerClient.onTabDetached;");
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    startDebugging: function(tabGrip)
    {
        this.connection.attachTab(tabGrip.actor, function(response, tabActor)
        {
            if (!tabActor)
            {
                Cu.reportError("No tab client found!");
                return;
            }

            this.tabActor = tabActor;

            this.attachThread(response.threadActor, function(response, threadClient)
            {
                if (!threadClient)
                {
                    Cu.reportError("Couldn't attach to thread: " + response.error);
                    return;
                }

                this.activeThread = threadClient;

                this.scripts = new SourceScripts(this.connection,this.activeThread);

                // Connect script manager and resume remote thread.
                this.scripts.connect();
                this.activeThread.resume();

                FBTrace.sysout("debuggerClient.startDebugging; ", this);

            }.bind(this));
        }.bind(this));
    },

    attachThread: function DebuggerClient_attachThread(threadActor, onResponse)
    {
        var packet = {
            to: threadActor,
            type: "attach"
        };

        var self = this;
        this.connection.request(packet, function(response)
        {
            if (!response.error)
            {
                var threadClient = new ThreadClient(self.connection, threadActor);
                self.threadClients[threadActor] = threadClient;
                self.activeThread = threadClient;
            }

            onResponse(response, threadClient);
        });
    },

});

// ********************************************************************************************* //

/**
 * Keeps the source script list up-to-date, using the thread client's
 * source script cache.
 */
function SourceScripts(client, thread)
{
    this.client = client;
    this.thread = thread;
}

SourceScripts.prototype =
{
    connect: function(callback)
    {
        this.thread.addListener(this);

        // Retrieve the list of scripts known to the server from before the client
        // was ready to handle new script notifications.
        this.thread.fillScripts();
    },

    disconnect: function()
    {
        
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    onNewScript: function(notification, packet)
    {
        FBTrace.sysout("SourceScripts.onNewScript; " + notification, packet);
    },

    onScriptsAdded: function(scriptCache)
    {
        FBTrace.sysout("SourceScripts.onScriptsAdded; ", scriptCache);

        for (var p in scriptCache)
        {
            var script = scriptCache[p];
            var sourceFile = new SourceFile(script.url, script.startLine, script.lineCount);
            this.watchSourceFile(sourceFile);
        }
    },

    onScriptsCleared: function()
    {
        
    },

    watchSourceFile: function(sourceFile)
    {
        // xxxHonza: the Script panel update should happen from within the Script panel
        // The DebuggerClient (or SourceScripts) should just fire an event to the panel.

        var context = Firebug.currentContext;

        // store in the context and notify listeners
        context.addSourceFile(sourceFile);

        // Update the Script panel, this script could have been loaded asynchronously
        // and perhaps is the only one that should be displayed (otherwise the panel
        // would show: No Javascript on this page). See issue 4932
        var panel = context.getPanel("jsd2script", true);
        if (!panel)
            return;

        context.invalidatePanels("jsd2script");

        if (!panel.location)
            panel.navigate(null);
    },
};

// ********************************************************************************************* //
// Registration

return DebuggerClient;

// ********************************************************************************************* //
});