define(["dojo/_base/array","dojo/_base/kernel", "dojo/_base/declare", "dojo/on", "dojo/aspect", "dojo/has", "./util/misc", "dojo/has!touch?./TouchScroll", "xstyle/has-class", "put-selector/put", "dojo/_base/sniff", "xstyle/css!./css/dgrid.css"], 
function(arrayUtil, kernel, declare, listen, aspect, has, miscUtil, TouchScroll, hasClass, put){
	// Add user agent/feature CSS classes 
	hasClass("mozilla", "opera", "webkit", "ie", "ie-6", "ie-6-7", "quirks", "no-quirks", "touch");
	
	var scrollbarWidth;

	// establish an extra stylesheet which addCssRule calls will use,
	// plus an array to track actual indices in stylesheet for removal
	var
		extraSheet = put(document.getElementsByTagName("head")[0], "style"),
		extraRules = [],
		oddClass = "dgrid-row-odd",
		evenClass = "dgrid-row-even";
	// keep reference to actual StyleSheet object (.styleSheet for IE < 9)
	extraSheet = extraSheet.sheet || extraSheet.styleSheet;
	
	// functions for adding and removing extra style rules.
	// addExtraRule is exposed on the List prototype as addCssRule.
	function addExtraRule(selector, css){
		var index = extraRules.length;
		extraRules[index] = (extraSheet.cssRules || extraSheet.rules).length;
		extraSheet.addRule ?
			extraSheet.addRule(selector, css) :
			extraSheet.insertRule(selector + '{' + css + '}', extraRules[index]);
		return {
			remove: function(){ removeExtraRule(index); }
		};
	}
	function removeExtraRule(index){
		var
			realIndex = extraRules[index],
			i, l = extraRules.length;
		if (realIndex === undefined) { return; } // already removed
		
		// remove rule indicated in internal array at index
		extraSheet.deleteRule ?
			extraSheet.deleteRule(realIndex) :
			extraSheet.removeRule(realIndex); // IE < 9
		
		// Clear internal array item representing rule that was just deleted.
		// NOTE: we do NOT splice, since the point of this array is specifically
		// to negotiate the splicing that occurs in the stylesheet itself!
		extraRules[index] = undefined;
		
		// Then update array items as necessary to downshift remaining rule indices.
		// Can start at index, since array is sparse but strictly increasing.
		for(i = index; i < l; i++){
			if(extraRules[i] > realIndex){ extraRules[i]--; }
		}
	}
	
	function byId(id){
		return document.getElementById(id);
	}

	function move(item, steps, targetClass, visible){
		var nextSibling, current, element;
		element = current = item.element;
		steps = steps || 1;
		do{
			// move in the correct direction
			if(nextSibling = current[steps < 0 ? 'previousSibling' : 'nextSibling']){
				do{
					current = nextSibling;
					if(((current && current.className) + ' ').indexOf(targetClass + ' ') > -1){
						// it's an element with the correct class name, counts as a real move
						element = current;
						steps += steps < 0 ? 1 : -1;
						break;
					}
					// if the next sibling isn't a match, drill down to search
				}while(nextSibling = (!visible || !current.hidden) && current[steps < 0 ? 'lastChild' : 'firstChild']);
			}else if((current = current.parentNode) == this.domNode || (current.className + ' ').indexOf("dgrid-row ") > -1){ // intentional assignment
				// we stepped all the way out of the grid, given up now
				break;
			}
		}while(steps);
		return element;		
	}
	
	// var and function for autogenerating ID when one isn't provided
	var autogen = 0;
	function generateId(){
		return "dgrid_" + autogen++;
	}
	
	// window resize event handler
	var winResizeHandler = has("ie") < 7 && !has("quirks") ? function(grid){
		// IE6 triggers window.resize on any element resize;
		// avoid useless calls (and infinite loop if height: auto).
		// The measurement logic here is based on dojo/window logic.
		var root, w, h, dims;
		
		if(!grid._started){ return; } // no sense calling resize yet
		
		root = document.documentElement;
		w = root.clientWidth;
		h = root.clientHeight;
		dims = grid._prevWinDims || [];
		if(dims[0] !== w || dims[1] !== h){
			grid.resize();
			grid._prevWinDims = [w, h];
		}
	} :
	function(grid){
		grid._started && grid.resize();
	};
	
	return declare(TouchScroll ? [TouchScroll] : [], {
		tabableHeader: false,
		// showHeader: Boolean
		//		Whether to render header (sub)rows.
		showHeader: false,
		// showFooter: Boolean
		//		Whether to render footer area.  Extensions which display content
		//		in the footer area should set this to true.
		showFooter: false,
		// maintainOddEven: Boolean
		//		Indicates whether to maintain the odd/even classes when new rows are inserted.
		//		This can be disabled to improve insertion performance if odd/even styling is not employed.
		maintainOddEven: true,
		
		postscript: function(params, srcNodeRef){
			// perform setup and invoke create in postScript to allow descendants to
			// perform logic before create/postCreate happen (a la dijit/_WidgetBase)
			var grid = this;
			
			(this._Row = function(id, object, element){
				this.id = id;
				this.data = object;
				this.element = element;
			}).prototype.remove = function(){
				grid.removeRow(this.element);
			};
			
			if(srcNodeRef){
				// normalize srcNodeRef and store on instance during create process.
				// Doing this in postscript is a bit earlier than dijit would do it,
				// but allows subclasses to access it pre-normalized during create.
				this.srcNodeRef = srcNodeRef =
					srcNodeRef.nodeType ? srcNodeRef : byId(srcNodeRef);
			}
			this.create(params, srcNodeRef);
		},
		listType: "list",
		
		create: function(params, srcNodeRef){
			// mix in params now, but wait until postScript to create
			if(params){
				this.params = params;
				declare.safeMixin(this, params);
				
				// handle sort param - TODO: revise @ 1.0 when _sort -> sort
				this._sort = params.sort || [];
				delete this.sort; // ensure back-compat method isn't shadowed
			}else{
				this._sort = [];
			}
			var domNode = this.domNode = srcNodeRef || put("div");
			
			// ensure arrays and hashes are initialized
			this.observers = [];
			this._listeners = [];
			this._rowIdToObject = {};
			
			this.postMixInProperties && this.postMixInProperties();
			
			// Apply id to widget and domNode,
			// from incoming node, widget params, or autogenerated.
			this.id = domNode.id = domNode.id || this.id || generateId();
			
			this.buildRendering();
			this.postCreate && this.postCreate();
			
			// remove srcNodeRef instance property post-create
			delete this.srcNodeRef;
			// to preserve "it just works" behavior, call startup if we're visible
			if(this.domNode.offsetHeight){
				this.startup();
			}
		},
		buildRendering: function(){
			var domNode = this.domNode,
				grid = this,
				headerNode, spacerNode, bodyNode, footerNode, isRTL;
			
			// Detect RTL on html/body nodes; taken from dojo/dom-geometry
			isRTL = this.isRTL = (document.body.dir || document.documentElement.dir ||
				document.body.style.direction).toLowerCase() == "rtl";
			
			put(domNode, "[role=grid].ui-widget.dgrid.dgrid-" + this.listType);
			headerNode = this.headerNode = put(domNode, 
				"div.dgrid-header.dgrid-header-row.ui-widget-header" +
				(this.showHeader ? "" : ".dgrid-header-hidden"));
			if(has("quirks") || has("ie") < 8){
				spacerNode = put(domNode, "div.dgrid-spacer");
			}
			bodyNode = this.bodyNode = this.touchNode = put(domNode, "div.dgrid-scroller");
			
			// firefox 4 until at least 10 adds overflow: auto elements to the tab index by default for some
			// reason; force them to be not tabbable
			bodyNode.tabIndex = -1;
			
			this.headerScrollNode = put(domNode, "div.dgrid-header-scroll.dgrid-scrollbar-width.ui-widget-header");
			
			footerNode = this.footerNode = put("div.dgrid-footer");
			// hide unless showFooter is true (set by extensions which use footer)
			if (!this.showFooter) { footerNode.style.display = "none"; }
			put(domNode, footerNode);
			
			if(isRTL){
				domNode.className += " dgrid-rtl" + (has("webkit") ? "" : " dgrid-rtl-nonwebkit");
			}
			
			listen(bodyNode, "scroll", function(event){
				// keep the header aligned with the body
				headerNode.scrollLeft = bodyNode.scrollLeft;
				// re-fire, since browsers are not consistent about propagation here
				event.stopPropagation();
				listen.emit(domNode, "scroll", {scrollTarget: bodyNode});
			});
			this.configStructure();
			this.renderHeader();
			
			this.contentNode = put(this.bodyNode, "div.dgrid-content.ui-widget-content");
			// add window resize handler, with reference for later removal if needed
			this._listeners.push(this._resizeHandle = listen(window, "resize",
				miscUtil.debounce(winResizeHandler)));
		},
		startup: function(){
			// summary:
			//		Called automatically after postCreate if the component is already
			//		visible; otherwise, should be called manually once placed.
			
			this.inherited(arguments);
			if(this._started){ return; } // prevent double-triggering
			this._started = true;
			this.resize();
			// apply sort (and refresh) now that we're ready to render
			this.set("sort", this._sort);
		},
		
		configStructure: function(){
			// does nothing in List, this is more of a hook for the Grid
		},
		resize: function(){
			var
				bodyNode = this.bodyNode,
				headerNode = this.headerNode,
				footerNode = this.footerNode,
				headerHeight = headerNode.offsetHeight,
				footerHeight = this.showFooter ? footerNode.offsetHeight : 0,
				quirks = has("quirks") || has("ie") < 7;
			
			this.headerScrollNode.style.height = bodyNode.style.marginTop = headerHeight + "px";
			if(footerHeight){ bodyNode.style.marginBottom = footerHeight + "px"; }
			
			if(quirks){
				// in IE6 and quirks mode, the "bottom" CSS property is ignored.
				// We guard against negative values in case of issues with external CSS.
				bodyNode.style.height = ""; // reset first
				bodyNode.style.height =
					Math.max((this.domNode.offsetHeight - headerHeight - footerHeight), 0) + "px";
				if (footerHeight) {
					// Work around additional glitch where IE 6 / quirks fails to update
					// the position of the bottom-aligned footer; this jogs its memory.
					footerNode.style.bottom = '1px';
					setTimeout(function(){ footerNode.style.bottom = ''; }, 0);
				}
			}
			
			if(!scrollbarWidth){
				// Measure the browser's scrollbar width using a DIV we'll delete right away
				var scrollDiv = put(document.body, "div.dgrid-scrollbar-measure");
				scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
				put(scrollDiv, "!");
				
				// avoid crazy issues in IE7 only, with certain widgets inside
				if(has("ie") === 7){ scrollbarWidth++; }
				
				// add rules that can be used where scrollbar width/height is needed
				this.addCssRule(".dgrid-scrollbar-width", "width: " + scrollbarWidth + "px");
				this.addCssRule(".dgrid-scrollbar-height", "height: " + scrollbarWidth + "px");
				
				if(scrollbarWidth != 17 && !quirks){
					// for modern browsers, we can perform a one-time operation which adds
					// a rule to account for scrollbar width in all grid headers.
					this.addCssRule(".dgrid-header", "right: " + scrollbarWidth + "px");
					// add another for RTL grids
					this.addCssRule(".dgrid-rtl-nonwebkit .dgrid-header", "left: " + scrollbarWidth + "px");
				}
			}
			
			if(quirks){
				// old IE doesn't support left + right + width:auto; set width directly
				headerNode.style.width = bodyNode.clientWidth + "px";
				setTimeout(function(){
					// sync up (after the browser catches up with the new width)
					headerNode.scrollLeft = bodyNode.scrollLeft;
				}, 0);
			}
		},
		addCssRule: addExtraRule,
		on: function(eventType, listener){
			// delegate events to the domNode
			var signal = listen(this.domNode, eventType, listener);
			if(!has("dom-addeventlistener")){
				this._listeners.push(signal);
			}
		},
		
		cleanup: function(){
			var observers = this.observers,
				i;
			// iterate through all the row elements and clean them up
			for(i in this._rowIdToObject){
				if(this._rowIdToObject[i] != this.columns){
					var rowElement = byId(i);
					if(rowElement){
						this.removeRow(rowElement, true);
					}
				}
			}
			// remove any store observers
			for(i = 0;i < observers.length; i++){
				var observer = observers[i];
				observer && observer.cancel();
			}
			this.observers = [];
			this.preload = null;
		},
		destroy: function(){
			// summary:
			//		Destroys this grid
			
			// remove any event listeners
			for(var i = this._listeners.length; i--;){
				this._listeners[i].remove();
			}
			delete this._listeners;
			
			this.cleanup();
			// destroy DOM
			put("!", this.domNode);
		},
		refresh: function(){
			// summary:
			//		refreshes the contents of the grid
			this.cleanup();
			this._rowIdToObject = {};
			this._autoId = 0;
			
			// make sure all the content has been removed so it can be recreated
			this.contentNode.innerHTML = "";
		},
		newRow: function(object, before, to, options){
			if(before.parentNode){
				var i = options.start + to;
				var row = this.insertRow(object, before.parentNode, before, i, options);
				put(row, ".ui-state-highlight");
				setTimeout(function(){
					put(row, "!ui-state-highlight");
				}, 250);
				return row;
			}
		},
		adjustRowIndices: function(firstRow){
			if(this.maintainOddEven){
				// this traverses through rows to maintain odd/even classes on the rows when indexes shift;
				var next = firstRow;
				var rowIndex = next.rowIndex;
				do{
					if(next.rowIndex > -1){
						// skip non-numeric, non-rows
						put(next, '.' + (rowIndex % 2 == 1 ? oddClass : evenClass) + '!' + (rowIndex % 2 == 0 ? oddClass : evenClass));
						next.rowIndex = rowIndex;
						rowIndex += "rowCount" in next ? next.rowCount : 1;
					}
				}while((next = next.nextSibling) && next.rowIndex != rowIndex);
			}
		},
		renderArray: function(results, beforeNode, options){
			// summary:
			//		This renders an array or collection of objects as rows in the grid, before the
			//		given node. This will listen for changes in the collection if an observe method
			//		is available (as it should be if it comes from an Observable data store).
			options = options || {};
			var self = this,
				start = options.start || 0,
				row, rows;
			
			if(!beforeNode){
				this._lastCollection = results;
			}
			if(results.observe){
				// observe the results for changes
				var observerIndex = this.observers.push(results.observe(function(object, from, to){
					var firstRow;
					// a change in the data took place
					if(from > -1 && rows[from]){
						// remove from old slot
						row = rows.splice(from, 1)[0];
						// check to make the sure the node is still there before we try to remove it, (in case it was moved to a different place in the DOM)
						if(row.parentNode == (beforeNode ? beforeNode.parentNode : self.contentNode)){
							firstRow = row.nextSibling;
							firstRow.rowIndex--; // adjust the rowIndex so adjustRowIndices has the right starting point
							self.removeRow(row); // now remove
						}
					}
					if(to > -1){
						// add to new slot (either before an existing row, or at the end)
						row = self.newRow(object, rows[to] || beforeNode, to, options);
						if(row){
							row.observerIndex = observerIndex;
							rows.splice(to, 0, row);
							if(!firstRow || to < firstRow.rowIndex){
								firstRow = row;
							}
						}
					}
					from != to && firstRow && self.adjustRowIndices(firstRow);
				}, true)) - 1;
			}
			var rowsFragment = document.createDocumentFragment();
			// now render the results
			if(results.map){
				rows = results.map(mapEach, console.error);
				if(rows.then){
					return rows.then(whenDone);
				}
			}else{
				rows = [];
				for(var i = 0, l = results.length; i < l; i++){
					rows[i] = mapEach(results[i]);
				}
			}
			var lastRow;
			function mapEach(object){
				lastRow = self.insertRow(object, rowsFragment, null, start++, options);
				lastRow.observerIndex = observerIndex;
				return lastRow;
			}
			function whenDone(resolvedRows){
				var container = beforeNode ? beforeNode.parentNode : self.contentNode;
				if(container){
					// If the node we're inserting after represents a block of rows (preload/loading etc),
					// we may need to reduce its size because of queryRowsOverlap. This code will work if
					// for some reason there is a rowIndex gap between beforeNode and its previous sibling
					var reclaimFrom = beforeNode && beforeNode.previousSibling,
						rowsToReclaim = reclaimFrom && reclaimFrom.rowIndex + reclaimFrom.rowCount - options.start;
					while (rowsToReclaim && reclaimFrom && !miscUtil.isDataRow(reclaimFrom) && reclaimFrom.rowCount != null){
						var canReclaim = Math.min(rowsToReclaim, reclaimFrom.rowCount);
						reclaimFrom.style.height = Math.max(0, reclaimFrom.offsetHeight - canReclaim * self.rowHeight) + "px";
						reclaimFrom.rowCount -= canReclaim;
						reclaimFrom = reclaimFrom.previousSibling;
						rowsToReclaim -= canReclaim;
					}
					container.insertBefore(rowsFragment, beforeNode || null);
					lastRow = resolvedRows[resolvedRows.length - 1];
					lastRow && self.adjustRowIndices(lastRow);
				}
				return (rows = resolvedRows);
			}
			return whenDone(rows);
		},
		_autoId: 0,
		renderHeader: function(){
			// no-op in a plain list
		},
		insertRow: function(object, parent, beforeNode, i, options){
			// summary:
			//		Renders a single row in the grid
			var id = this.id + "-row-" + ((this.store && this.store.getIdentity) ? this.store.getIdentity(object) : this._autoId++);
			var row = byId(id);
			if(!row || // we must create a row if it doesn't exist, or if it previously belonged to a different container 
					(beforeNode && row.parentNode != beforeNode.parentNode)){
				if(row){// if it existed elsewhere in the DOM, we will remove it, so we can recreate it
					this.removeRow(row);
				}
				row = this.renderRow(object, options);
				row.className = (row.className || "") + " ui-state-default dgrid-row " + (i% 2 == 1 ? oddClass : evenClass);
				// get the row id for easy retrieval
				this._rowIdToObject[row.id = id] = object;
			}
			parent.insertBefore(row, beforeNode);
			row.rowIndex = i;
			return row;
		},
		renderRow: function(value, options){
			return put("div", "" + value);
		},
		removeRow: function(rowElement, justCleanup){
			// summary:
			//		Simply deletes the node in a plain List.
			//		Column plugins may aspect this to implement their own cleanup routines.
			if(!justCleanup){
				put(rowElement, "!");
			}
		},
		row: function(target){
			// summary:
			//		Get the row object by id, object, node, or event
			var id;
			
			if(target instanceof this._Row){ return target; } // no-op; already a row
			
			if(target.target && target.target.nodeType){
				// event
				target = target.target;
			}
			if(target.nodeType){
				var object;
				do{
					var rowId = target.id;
					if((object = this._rowIdToObject[rowId])){
						return new this._Row(rowId.substring(this.id.length + 5), object, target); 
					}
					target = target.parentNode;
				}while(target && target != this.domNode);
				return;
			}
			if(typeof target == "object"){
				// assume target represents a store item
				id = this.store.getIdentity(target);
			}else{
				// assume target is a row ID
				id = target;
				target = this._rowIdToObject[this.id + "-row-" + id];
			}
			return new this._Row(id, target, byId(this.id + "-row-" + id));
		},
		cell: function(target){
			// this doesn't do much in a plain list
			return {
				row: this.row(target)
			};
		},
		_move: move,
		up: function(row, steps, visible){
			return this.row(move(row, -(steps || 1), "dgrid-row", visible));
		},
		down: function(row, steps, visible){
			return this.row(move(row, steps || 1, "dgrid-row", visible));
		},
		
		get: function(/*String*/ name /*, ... */){
			// summary:
			//		Get a property on a List instance.
			//	name:
			//		The property to get.
			//	returns:
			//		The property value on this List instance.
			// description:
			//		Get a named property on a List object. The property may
			//		potentially be retrieved via a getter method in subclasses. In the base class
			//		this just retrieves the object's property.
			
			var fn = "_get" + name.charAt(0).toUpperCase() + name.slice(1);
			
			if(typeof this[fn] === "function"){
				return this[fn].apply(this, [].slice.call(arguments, 1));
			}
			
			// Alert users that try to use Dijit-style getter/setters so they don’t get confused
			// if they try to use them and it does not work
			if(!has("dojo-built") && typeof this[fn + "Attr"] === "function"){
				console.warn("dgrid: Use " + fn + " instead of " + fn + "Attr for getting " + name);
			}
			
			return this[name];
		},
		
		set: function(/*String*/ name, /*Object*/ value /*, ... */){
			//	summary:
			//		Set a property on a List instance
			//	name:
			//		The property to set.
			//	value:
			//		The value to set in the property.
			//	returns:
			//		The function returns this List instance.
			//	description:
			//		Sets named properties on a List object.
			//		A programmatic setter may be defined in subclasses.
			//
			//	set() may also be called with a hash of name/value pairs, ex:
			//	|	myObj.set({
			//	|		foo: "Howdy",
			//	|		bar: 3
			//	|	})
			//	This is equivalent to calling set(foo, "Howdy") and set(bar, 3)
			
			if(typeof name === "object"){
				for(var k in name){
					this.set(k, name[k]);
				}
			}else{
				var fn = "_set" + name.charAt(0).toUpperCase() + name.slice(1);
				
				if(typeof this[fn] === "function"){
					this[fn].apply(this, [].slice.call(arguments, 1));
				}else{
					// Alert users that try to use Dijit-style getter/setters so they don’t get confused
					// if they try to use them and it does not work
					if(!has("dojo-built") && typeof this[fn + "Attr"] === "function"){
						console.warn("dgrid: Use " + fn + " instead of " + fn + "Attr for setting " + name);
					}
					
					this[name] = value;
				}
			}
			
			return this;
		},
		
		_setSort: function(property, descending){
			// summary:
			//		Sort the content
			// property: String|Array
			//		String specifying field to sort by, or actual array of objects
			//		with attribute and descending properties
			// descending: boolean
			//		In the case where property is a string, this argument
			//		specifies whether to sort ascending (false) or descending (true)
			
			this._sort = typeof property != "string" ? property :
				[{attribute: property, descending: descending}];
			
			this.refresh();
			
			if(this._lastCollection){
				if(property.length){
					// if an array was passed in, flatten to just first sort attribute
					// for default array sort logic
					if(typeof property != "string"){
						descending = property[0].descending;
						property = property[0].attribute;
					}
					
					this._lastCollection.sort(function(a,b){
						var aVal = a[property], bVal = b[property];
						// fall back undefined values to "" for more consistent behavior
						if(aVal === undefined){ aVal = ""; }
						if(bVal === undefined){ bVal = ""; }
						return aVal == bVal ? 0 : (aVal > bVal == !descending ? 1 : -1);
					});
				}
				this.renderArray(this._lastCollection);
			}
		},
		// TODO: remove the following two (and rename _sort to sort) in 1.0
		sort: function(property, descending){
			kernel.deprecated("sort(...)", 'use set("sort", ...) instead', "dgrid 1.0");
			this.set("sort", property, descending);
		},
		_getSort: function(){
			return this._sort;
		},
		
		_setShowHeader: function(show){
			// this is in List rather than just in Grid, primarily for two reasons:
			// (1) just in case someone *does* want to show a header in a List
			// (2) helps address IE < 8 header display issue in List
			
			this.showHeader = show;
			
			// add/remove class which has styles for "hiding" header
			put(this.headerNode, (show ? "!" : ".") + "dgrid-header-hidden");
			
			this.renderHeader();
			this.resize(); // to account for (dis)appearance of header
		},
		setShowHeader: function(show){
			kernel.deprecated("setShowHeader(...)", 'use set("showHeader", ...) instead', "dgrid 1.0");
			this.set("showHeader", show);
		}
	});
});
