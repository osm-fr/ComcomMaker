OpenLayers.Control.Click = OpenLayers.Class(OpenLayers.Control, {
    defaultHandlerOptions: {
        'single': true,
        'double': false,
        'pixelTolerance': 0,
        'stopSingle': false,
        'stopDouble': false
    },

    initialize: function(options) {
        this.handlerOptions = OpenLayers.Util.extend(
            {}, this.defaultHandlerOptions
        );
        OpenLayers.Control.prototype.initialize.apply(
            this, arguments
        );
        this.handler = new OpenLayers.Handler.Click(
            this, {
                'click': this.trigger
            }, this.handlerOptions
        );
    },

    trigger: function(e) {
        var lonlat = map.getLonLatFromViewPortPx(e.xy)
            .transform(
                new OpenLayers.Projection("EPSG:900913"), // from Spherical Mercator Projection
                new OpenLayers.Projection("EPSG:4326") // to WGS 1984
                );
        var params ={
                'lat':lonlat.lat,
                'lon':lonlat.lon
            }
        var where=document.getElementById('ccTagsIn')
        if(where.value && where.value.trim()){
            where.value = where.value.replace('\n\n','\n').trim()
            params['where']=where.value
        }
        map.ccm.pids.add(OpenLayers.Request.GET({
            'url':'ajax.py',
            'params':params,
            'callback':function(request){
//                console.log(request);
//                console.log(responseJSON)
                switch (request.status){
                    case 200:
                        var responseJSON = JSON.parse(request.responseText);
                        var data = responseJSON['data']
                        console.log(data);
                        map.ccm.addItem(data);
                        break;
                    case 204: // Nothing found
                        console.log(data)
                        alert(request.status + ' Nothing found');
                        break;
                    case 206: // several result first sent
                        alert(request.status + ' several result first sent');
                        var responseJSON = JSON.parse(request.responseText);
                        var data = responseJSON['data']
                        map.ccm.addItem(data)
                        break;
                    case 400: // bad request
                        alert(request.status + ' Bad request');
                        break;
                };
                map.ccm.pids.remove(request);
            }
        }))
    }
});

function init() {
    var pids = {'_':[],
        add : function(process){
            this._.push(process);
            map.ccm.displayRunningControl(this._.length);
        },
        remove : function(process){
            for(var i in this._){
                if(this._[i]==process){
                    this._.splice(i,1);
                }
            }
            map.ccm.displayRunningControl(this._.length);
        },
        reset : function(){
            this._ = [];
            map.ccm.displayRunningControl(this._.length);
        }
    };
    var projEPSG900913 = new OpenLayers.Projection("EPSG:900913")
    var projEPSG4326 = new OpenLayers.Projection("EPSG:4326");
    
    var ccm={
        templates:{"item": "<li class='item' id='{{ id }}' >"
            + "<a href='http://www.openstreetmap.org/browse/{{ type }}/{{ uid }}' target='_blank' title='browse {{ type }}'>"
            +"<img id='info{{ id }}' src='js/images/silk/map.png' style='width:12px;height:12px;' />"
            +"</a>&nbsp;"
            + "<a href='javascript:void(map.ccm.removeItem({{ id }}));' title='remove'>"
            +"<img id='del{{ id }}' src='js/images/silk/delete.png' style='width:12px;height:12px;' />"
            +"</a>"
            +" {{ name }} </li>",
                "tags": '<table id="editTagRows">{% for tag in tags %}{% include tagRow %}{% endfor %}</table><div class="toolbar"><img src="js/images/silk/cancel.png" alt="cancel" title="Cancel changes"  onclick="map.ccm.editTags_close(\'{{witch}}\')"/> <img src="js/images/silk/textfield_add.png" title="New tag" alt="add" onclick="map.ccm.editTags_add(\'{{witch}}\')" /> <img src="js/images/silk/textfield_ok.png" title="Save tags" alt="save" onclick="map.ccm.editTags_save(\'{{witch}}\')" /></div>',
                "tagRow":'<tr><td>{{ forloop.key}}</td><td><input type="text" name="{{ forloop.key}}" value="{{ tag }}" /></td><td><a href="http://wiki.openstreetmap.org/wiki/Key:{{ forloop.key}}" target="_blank"><img src="js/images/silk/help.png" alt="help" title="Show \'key:{{ forloop.key}}\' on the wiki"/></a></td></tr>'
            },
        list: document.getElementById('ccList'),
        itemCount: document.getElementById('itemCount'),
        rels: document.getElementById('ccRels'),
        tagsIn: document.getElementById('ccTagsIn'),
        tagsOut: document.getElementById('ccTagsOut'),
        josmRemote: document.getElementById('ccJosmRemote'),
        items: [],
        polys: {},
        features: {},
        base: document.getElementsByTagName('base')[0].getAttribute('href'),
        'pids':pids,
        'vectors': undefined,
        wkt: new OpenLayers.Format.WKT({
            'internalProjection': projEPSG900913,
            'externalProjection': projEPSG4326
        }),
        // ----- methods ----- //
        addItem: function(data){
            // add entity to the list
            var exists = false;
            for(var i in this.items){
                exists = exists | (data.id == this.items[i].id)
            }
            if(!exists){
                data.type = data.id[0] == '-' ? 'relation' : 'way'
                data.uid = data.id[0] == '-' ? data.id.substr(1) : data.id
                data.name = data.name=='None' ? data.type+":"+data.uid : data.name;
                data.html = this.templates.item.render(data)
                this.items.push(data);
                this.items.sort(function(a,b){
                    if(a.name == b.name){
                        return 0;
                    }
                    return a.name > b.name;
                })
                data.feature = this.addFeature(data);
//                this.adPoly(data.id);
                this.refreshList();
            }
        },
        addFeature: function(data){
            // add entity to the map from local wkt
            // display area
            var feature = this.parseWKT(data.wkt)
            if(feature) {
                feature.style= {
                    strokeColor: "blue",
                    strokeWidth: 3,
                    strokeOpacity: 0.5,
                    fillOpacity: 0.5,
                    fillColor: "lightblue",
                    pointRadius: 6
                }
                this.vectors.addFeatures(feature);
                this.features[data.id] = feature;
                return feature;
            }
            return undefined;
        },
        adPoly: function(id){
            // add entity to the map from downloaded osm data
            // doesn't show the area, only boundaries
            if (id in this.polys) {
                return;
            }
            var layer = new OpenLayers.Layer.GML("addpolygone", "cache/r" + Math.abs(id) + '.osm', {
                format: OpenLayers.Format.OSM,
                style: {
                    strokeColor: "blue",
                    strokeWidth: 3,
                    strokeOpacity: 0.5,
                    fillOpacity: 0.2,
                    fillColor: "lightblue",
                    pointRadius: 6
                },
                projection: new OpenLayers.Projection("EPSG:4326"),
                displayInLayerSwitcher: false
                });
            map.addLayer(layer);
            layer.loadGML();
            this.polys[id] = layer;
        },
        editTags: function(witch){
            var tagSet = document.getElementById("ccTags"+witch).value.replace(/\n/g,',');
            var tagArray = tagSet.split(',')
            var tags = {};
            for(var k in tagArray){
                var t = tagArray[k].split('=');
                tags[t[0]]=t[1];
            }
            for(var i in overlays){
                if(overlays[i][0] == tagSet && overlays[i][2]){
                    var test = overlays[i][2]
                    for(var k in overlays[i][2]){
                        tags[k]=overlays[i][2][k];
                    }
                }
            }
            var html = this.templates.tags.render({tags:tags,witch:witch},{templates:this.templates});
            document.getElementById('tagEditor').innerHTML = html;
            document.getElementById('tagEditor-container').style.display="block"
        },
        editTags_close: function(witch){
            document.getElementById('tagEditor-container').style.display="none";
        },
        editTags_add: function(witch){
            var key = prompt("Entrez le nome de la clef à ajouter :");
            if(key){
                var tmp = document .createElement( 'tbody' );
                tmp.innerHTML=this.templates.tagRow.render({tag:"",forloop:{key:key}});
                document.getElementById('editTagRows').appendChild(tmp.firstChild);
            }
        },
        editTags_save: function(witch){
            var table= document.getElementById('editTagRows');
            var tagSet='', rows = table.getElementsByTagName('input');
            for( var i in rows){
                if(rows[i].value){
                    tagSet += rows[i].name + "=" + rows[i].value + "\n"
                }
            }
            document.getElementById("ccTags"+witch).innerHTML = tagSet.replace(/^\s+|\s+$/g, '');
            this.editTags_close();
        },
        enableButtons: function(){
            // enable/disable buttons
            var inputs = document.getElementsByTagName('input')
            var length = this.items.length;
            for (var j in inputs){
                try{
                    var type = inputs[j].getAttribute('type');
                } catch (e){
                    continue;
                }
                if (type !="button"){
                    continue;
                }
                if(length){
                    inputs[j].removeAttribute('disabled');
                } else {
                    inputs[j].setAttribute('disabled','yes')
                }
            }
        },
        parseWKT: function(wkt){
            return this.wkt.read(wkt);
        },
        plurialize: function(string){
            // foo bar -> foos bars
            return string.split(' ').join('s ')+'s'
        },
        removeItem: function(id){
            for(var i in this.items){
                if(this.items[i].id == id){
                    delete this.items[i];
                    this.items.splice(i,1)
                }
            }
            this.removeFeature(id);
            this.removePoly(id);
            this.refreshList();
        },
        removeFeature: function(id){
            if (id in this.features) {
                this.vectors.removeFeatures(this.features[id]);
                delete (this.features[id]);
            }
        },
        removePoly: function(id) {
            if (id in this.polys) {
                map.removeLayer(this.polys[id]);
                delete (this.polys[id]);
            }
        },
        refreshList: function(){
            // rebuild the list from item collection
            var listHtml = '', relsHtml = '';
            for(var i in this.items){
                listHtml += this.items[i].html;
                relsHtml += (this.items[i].id[0] == '-'
                            ? this.items[i].id.replace('-','r')
                            : 'w' + this.items[i].id
                            )
                            +',';
            }
            this.list.innerHTML=listHtml
            this.itemCount.innerHTML=this.items.length + ' élément(s)'
            this.rels.value=relsHtml;
            this.enableButtons();
            return i;
        },
        sendData: function(){
            params = {
                'tags':this.tagsOut.value.replace(/\n/g,','),
                'relations':this.rels.value
            }
            this.pids.add(OpenLayers.Request.GET({
                'url':this.base + 'comcommaker.py/',
                'params':params,
                'callback':function(request){
                    var responseJSON = JSON.parse(request.responseText);
//                    console.log(responseJSON)
                    switch (request.status){
                        case 200:
                            var responseJSON = JSON.parse(request.responseText);
                            var data = responseJSON['data']
//                            var url = 'http://localhost:8111/import?url=http://localhost/comcom/'+data['url'];
                            
                            var url = 'http://localhost:8111/import?url=http://comcommaker.openstreetmap.fr/'+data['url'];
                            map.ccm.josmRemote.src=url
                            break;
                        case 204: // Nothing found
                            alert(request.status + ' Nothing found');
                            break;
                        case 206: // several result first sent
                            alert(request.status + ' several result first sent');
                            map.ccm.addItem(request.responseJSON['data'])
                            break;
                        case 400: // bad request
                            alert(request.status + ' bad request');
                            break;
                        case 500: // Internal server error
                            alert(request.status + ' Internal server error');
                            break;
                    }
                    map.ccm.pids.remove(request);
                }
            }))
            return false;
        },
        clearData: function(){
            for (var i in this.features){
                this.removeFeature(i);
            }
            for (var i in this.polys){
                this.removeFeature(id);
                map.removeLayer(this.polys[i]);
            }
            this.pids.reset();
            this.features = {};
            this.polys = {};
            this.items = [];
            this.refreshList();
            this.rels.value=''
        },
        resetOut: function(){
            var ccPresetsOut = document.getElementById('ccPresetsOut');
            var ccDisplayOverlay = document.getElementById('ccDisplayOverlay').checked
            var tagSet = ccPresetsOut.options[ccPresetsOut.selectedIndex].value
            tagSet=tagSet.replace(/\n/g,',')
            this.overlays.setVisibility(false);
            map.ccm.tagsOut.value=tagSet.replace(/,/g,'\n')
            if(ccDisplayOverlay){
                for(var i in overlays){
                    if(overlays[i][0] == tagSet){
                        var url = overlays[i][1] + "${z}/${x}/${y}.png";
                        this.overlays.url = url;
                        this.overlays.setVisibility(true);
                        return true
                    }
                }
            }
        },
        displayRunningControl: function(pidsLength){
            var img= document.getElementById('displayRunningControl')
            img.style.display= pidsLength == 0 ? 'none': 'inline';
        }
    };
    OpenLayers.ImgPath = "js/theme/default/img/";
    map = new OpenLayers.Map("map",{
        maxExtent: new OpenLayers.Bounds(-20037508,-20037508,20037508,20037508)
    });
    map.ccm = ccm
    ccm.mapnik = new OpenLayers.Layer.OSM();
    ccm.overlays = new OpenLayers.Layer.OSM("Boundaries",
                           "http://a.layers.openstreetmap.fr/boundary_local_authority/${z}/${x}/${y}.png",
                           { numZoomLevels: 19,
                             isBaseLayer: false,
                             transitionEffect: "null",
                             opacity: 0.8,
                           });
    ccm.vectors = new OpenLayers.Layer.Vector("Vector Layer",{
        style: {
            strokeColor: "blue",
            strokeWidth: 3,
            strokeOpacity: 0.5,
            fillOpacity: 0.2,
            fillColor: "lightblue",
            pointRadius: 6
        },
    });
    map.addLayers([ccm.mapnik, ccm.overlays, ccm.vectors]);
    
    if (!map.getCenter()) {
        map.setCenter(new OpenLayers.LonLat(6.0121,47.2553) // Center of the map
            .transform(
                projEPSG4326, // transform from WGS 1984
                projEPSG900913 // to Spherical Mercator Projection
              ), 9 // Zoom level 12 for admin_level=8
            );
    }

    var click = new OpenLayers.Control.Click();
    map.addControls([
        click,
        new OpenLayers.Control.Permalink()
    ]);
    click.activate();
    
    // sinon il ne trace pas le premier poly...
    var layer = new OpenLayers.Layer.GML("addpolygone", "vide.osm", { format: OpenLayers.Format.OSM });
    map.addLayer(layer);
    layer.loadGML();
    map.removeLayer(layer)
  }
