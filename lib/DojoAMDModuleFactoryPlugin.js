/*
 * (C) Copyright HCL Technologies Ltd. 2018, 2019
 * (C) Copyright IBM Corp. 2012, 2016 All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const {pluginName, getPluginProps} = require('./DojoAMDPlugin');
const path = require("path");
const querystring = require("querystring");

/*
 * Initializes/updates/queries the absMid property on the specified object.  absMid is
 * a defined property with the following behaviors:
 *
 * 1. The property is associated with an array of objects with each object having a name
 *    and an isProvisional property.  By convention, non-provisional entries occur
 *    before provisional entries in the array.
 * 2. If the property is assigned a string value (e.g. data.absMid = "foo"), then
 *    an entry is added to the beginning of the array with the name property set to the
 *    assigned value and the isProvisional property set to false.
 * 3. If the property value is referenced (e.g. let absMid = data.absMid), then the
 *    name property of the first array entry is provided.
 * 4. If absMidsArray is provided to this function, then the value will replace the
 *    existing array associated with the property.  This facilitates copying the
 *    property from one object to another.  Note that the array is shallow copied, so
 *    changes to the provided array after it has been used to intialize an absMid
 *    property will not be reflected in the new property.
 * 5. If this function is called and the data object already has an absMid property of
 *    type string and absMidArray is undefined, then it becomes the name of the only
 *    entry in the array with isProvisional set to false.
 * 6. This function returns a reference to the array associated with the absMid
 *    property.  Copying the property with it's associated data and behavior to another
 *    object is accomplished as follows:
 *       initAbsMidProp(target, initAbsMidProp(source));
 */
function initAbsMidProp(data, absMidsArray) {
	if (absMidsArray) {
		// If we're array data is provided, then delete the existing prop
		delete data.absMid;
	}
	const existing = data.absMid;
	if (existing && typeof existing === 'string') {
		// Determine if the existing prop is one of ours or a plain old string
		const control = {control: 'getAbsMids'};
		data.absMid = control;  // magic happens here if prop is one of ours
		if (control.absMidsArray) {
			// absMids property was assigned to control object, so already
			// initialized.  Just return the array.  Note that we can't get
			// here if absMidsArray was provided, so nothing else to do.
			return control.absMidsArray;
		} else {
			// property was a plain old string.  Restore the value so we can
			// use it to intialized the array below.
			data.absMid = existing;
		}
	}
	const absMids = absMidsArray ? absMidsArray.slice() : [];

	// Define property setter and getter
	Object.defineProperty(data, 'absMid', {
		configurable: true,
		get() {
			return absMids[0] && absMids[0].name;
		},
		set(name) {
			// If assigned a control object with magic name and property, then
			// add an 'absMidsArray' property to the control object.
			if (typeof name === 'object' && name.control === 'getAbsMids') {
				name.absMidsArray = absMids;
				return;
			}
			if (!name || typeof name !== 'string') {
				throw new Error(`Illegal absMid: ${name} must a non empty string.`);
			}
			absMids.unshift({name: name, isProvisional: false});
		}
	});

	// If existing value of absMid property was a string,
	// then add a non-provisional entry to the array.
	if (existing && typeof existing === 'string') {
		absMids.unshift({name: existing, isProvisional: false});
	}
	return absMids;
}

module.exports = class DojoAMDModuleFactoryPlugin {
	constructor(options) {
		this.options = options;
		this._modules = new Map();
	}

	apply(compiler) {
		this.compiler = compiler;
		this.pluginProps = getPluginProps(compiler);
		compiler.hooks.normalModuleFactory.tap(pluginName, factory => {
			const context = Object.create(this, {factory: {value: factory}});
			compiler.hooks.run.tapAsync(pluginName, this.run.bind(this));
			compiler.hooks.watchRun.tapAsync(pluginName, this.run.bind(this));
			factory.hooks.beforeResolve.tapAsync(pluginName, this.beforeResolve.bind(context));
			factory.hooks.resolve.tapAsync(pluginName, this.resolver.bind(context));
			if (Array.isArray(this.options.locales) && !this.options.locales.includes('*')) {
				factory.hooks.afterResolve.tapAsync(pluginName, this.afterResolve.bind(context));
			}
		});
		compiler.hooks.compilation.tap(pluginName, (compilation, params) => {
			if (!this.options.isSkipCompilation(compilation)) {
				const context = Object.create(this, {
					compilation: {value: compilation},
					factory: {value: params.normalModuleFactory}
				});
				params.normalModuleFactory.hooks.module.tap(pluginName, this.module.bind(context));
				compilation.hooks.seal.tap(pluginName, this.trimAbsMids.bind(context));
				compilation.hooks.buildModule.tap(pluginName, this.buildModule.bind(context));
			}
		});
	}

	run(__, callback) {
		this._modules = new Map();
		callback();
	}

	/*
	 * Returns true if the passed request is an absMid.  If input is a string,
	 * then the input is split using '!' delimiter and each part is tested.  if
	 * request is an array, then each element of the array is tested.
	 */
	isAbsMid(request) {
		const parts = Array.isArray(request) ? request : request.split('!');
		return parts.every(part => !/^[./\\]/.test(part) && !path.isAbsolute(part));
	}

	toAbsMid(request, issuerAbsMid, dojoRequire) {
		var result = request;
		if (request) {
			const segments = [];
			let context;
			try {
				// extract context path from issuerAbsMid (it might be a loader expression)
				const parts = issuerAbsMid && issuerAbsMid.split('!') || [];
				while (!context && parts.length) context = parts.pop();
				if (context && context.indexOf('/') === -1) {
					context = null;
				}
				request.split("!").forEach((segment) => {
					segments.push(dojoRequire.toAbsMid(segment, context ? {mid: context} : null));
				});
				result = segments.join("!");
			} catch (ignore) {
			}
		}
		return result;
	}

	processAbsMidQueryArgs(data) {
		// Parse the absMid query args from request and add them to the data
		// object.  Any such query args are also removed from the request.
		const parts = data.request.split("!");
		parts.forEach((part, i) => {
			let idx = part.indexOf("?");
			if (idx !== -1) {
				let request = part.substring(0, idx);
				let query = querystring.parse(part.substring(idx+1));
				let absMids = query.absMid;
				if (absMids) {
					if (!Array.isArray(absMids)) {
						absMids = [absMids];
					}
					absMids.forEach(absMid => {
						absMid && this.addAbsMid(data, absMid);
					});
					delete query.absMid;
					if (Object.keys(query).length) {
						request = request + "?" + querystring.stringify(query);
					}
					parts[i] = request;
				}
			}
		});
		data.request = parts.join("!");
	}

	/*
	 * Adds an absMid alias for the module.  Keeps non-provisional absMids
	 * ahead of provisional absMids in the array.
	 */
	addAbsMid(data, absMid, isProvisional) {
		if (!absMid || typeof absMid !== 'string') {
			throw new Error(`Illegal absMid: ${absMid} must a non empty string.`);
		}
		const absMids = initAbsMidProp(data);
		const idx = absMids.findIndex(elem => elem.name === absMid);
		if (idx !== -1) {
			if (isProvisional && !absMids[idx].isProvisonal) {
				return;
			}
			absMids.splice(idx, 1);
		}
		let insertIdx = 0;
		if (isProvisional) {
			insertIdx = absMids.findIndex(entry => entry.isProvisional);
			if (insertIdx === -1) {
				insertIdx = absMids.length;
			}
		}
		absMids.splice(insertIdx, 0, {name: absMid, isProvisional: isProvisional});
	}

	/*
	 * Filters the absMids for a module
	 */
	filterAbsMids(data, callback) {
		let toKeep = [];
		const absMids = initAbsMidProp(data);
		absMids.forEach(absMid => {
			if (callback(absMid.name, absMid.isProvisional)) {
				toKeep.push(absMid);
			}
		});
		delete data.absMid;
		toKeep.reverse().forEach(absMid => {
			this.addAbsMid(data, absMid.name, absMid.isProvisional);
		});
	}

	/*
	 * Removes absMids for non-Dojo modules in the compilation.  Non-Dojo modules are
	 * modules which don't have the isAMD flag set, or modules to which non-provisional
	 * absMids have been added (e.g. loaders)
	 */
	trimAbsMids() {
		this.compilation.modules.forEach(module => {
			let shouldAdd = false;
			this.filterAbsMids(module, (absMid__, isProvisional) => {
				return shouldAdd = shouldAdd || module.isAMD || !isProvisional;
			});
		});
	}

	addAbsMidsFromRequest(data) {
		/*
		 * Determines the absMid aliases for this module and adds them to the data object.  An absMid can
		 * be derived from the request path, or from query args in the request.
		 * absMid aliases allow the module to be accessed at runtime using computed names who's values
		 * cannot be determined at build time.
		 */
		if (data) {
			this.processAbsMidQueryArgs(data);
			if (data.request.charAt(0) !== '!') {
				let context;
				if (data.dependencies) {
					data.dependencies.some(dep => context = dep.issuerModule && dep.issuerModule.absMid);
				}
				let absMid = this.toAbsMid(data.request, context, this.pluginProps.dojoRequire);
				data.request = absMid;

				// If no remaining relative or absolute paths, then set absMid
				if (this.isAbsMid(absMid)) {
					this.addAbsMid(data, absMid, true);
				}
			}
		}
	}

	beforeResolve(data, callback) {
		const dep = data.dependencies && data.dependencies[0];
		if (dep && dep.usingGlobalRequire && data.request.startsWith('.')) {
			// Global require with relative path.  Dojo resolves against the page.
			// We'll resolve against the compiler context or config defined global context
			const globalPath = this.options.getGlobalContext(this.compiler);
			data.request = path.resolve(globalPath, data.request);
			var relPath = path.relative(globalPath, data.request).replace(/\\/g,'/');
			if (this.isAbsMid(relPath)) {
				relPath = "./" + relPath;
			}
			this.addAbsMid(data, relPath, true);
		}
		this.addAbsMidsFromRequest(data, true);
		return callback(null);
	}

	afterResolve(data, callback) {
		if (/\/nls\/[^/]*\.js$/.test(data.createData.resource?.replace(/[/\\]/g, '/'))) {
			data.createData.loaders.push({
				loader: path.resolve(__dirname, "..", "loaders", "dojo", "i18nRootModifier"),
				options: `bundledLocales=${this.options.locales.join('|')}`
			});
		}
		callback();
	}

	resolver(data, callback) {
		// Add absMids from the request.  Note that we do it both here and in 'beforeResolve'
		// so that we get the absMid aliases for both pre- and post- replaced module identifiers.
		// This allows the same module to be referenced at runtime by either name
		// (e.g. 'dojo/selector/_loader!default' and 'dojo/selector/lite').
		this.addAbsMidsFromRequest(data);
		data.contextInfo.originalRequest = data.request;
		const resolveFn = this.factory.hooks.resolve.taps.find(elem => elem.name === 'NormalModuleFactory').fn;
		return resolveFn(data, (err) => {
			if (err && data.originalRequest) {
				data.request = data.originalRequest;
			}
			callback(err ? false : undefined);
		});
	}

	/*
	 * Last chance to add absMid before module is built.  We may succeed here
	 * where we failed previously now that the issuer module is available (it
	 * may have an absMid we can use for the context).
	 */
	buildModule(module) {
		// Need to reset this for watch mode so require calls prior to the define function
		// will be treated as cjs require when a module is re-compiled.
		delete module.isAMD;

		if (module.absMid || !module.originalRequest) return;
		const dojoRequire = this.pluginProps.dojoRequire;
		const issuer = this.compilation.moduleGraph.getIssuer(module);
		const issuerAbsMid = issuer && issuer.absMid;
		let absMid = this.toAbsMid(module.originalRequest, issuerAbsMid, dojoRequire);

		// Any remaining relative paths, try to resolve against baseUrl
		const parts = absMid.split('!')
			.map(part => {
				if (part.charAt(0) === '.') {
					const res = module.resource.replace(/\.jsx?$/, '');
					if (path.resolve(dojoRequire.baseUrl, part) === res) {
						var relative = path.relative(dojoRequire.baseUrl, res).replace(/[\\]/g, '/');
						if (relative.indexOf('/') !== -1) {
							return relative;
						}
					}
				}
				return part;
			});

		// If no remaining relative or absolute paths, then set absMid
		if (this.isAbsMid(parts)) {
			this.addAbsMid(module, parts.join('!'), true);
		}
	}

	module(module, createData__, resolveData) {
		if (!this._modules.get(this.compilation)) {
			this._modules.set(this.compilation, {});
		}
		const absMids = initAbsMidProp(resolveData);
		if (absMids.length) {
			initAbsMidProp(module, absMids);
		}
		module.originalRequest = resolveData.contextInfo?.originalRequest;
		// If the module already exists in the compilation, then copy the absMid data from
		// this module to the existing module since this module will be discarded.
		// Note: don't use initAbsMidProp as it would destroy the exising module's absMids.
		const existing = this._modules.get(this.compilation)[module.request];
		if (existing) {
			this.filterAbsMids(module, (absMid, isProvisional) => {
				this.addAbsMid(existing, absMid, isProvisional);
				return true;
			});
			return existing;
		}
		// Add functions to the module object for adding/filtering absMids (for use by loaders)
		module.addAbsMid = (absMid, isProvisional) => {
			if (absMid) {
				this.addAbsMid(module, absMid, isProvisional);
			} else {
				// This has the effect of making the index 0 absMid non-provisional,
				// assuring that this module's absMids will be exported to the client.
				module.absMid = module.absMid;
			}
		};
		module.filterAbsMids = callback => {
			this.filterAbsMids(module, callback);
		};
		this._modules.get(this.compilation)[module.request] = module;
		return module;
	}

};
