/*
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
/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
const DojoAMDRequireItemDependency = require("./DojoAMDRequireItemDependency");
const DojoAMDRequireArrayDependency = require("./DojoAMDRequireArrayDependency");
const ConstDependency = require("webpack/lib/dependencies/ConstDependency");
const LocalModuleDependency = require("webpack/lib/dependencies/LocalModuleDependency");
const LocalModulesHelpers = require("webpack/lib/dependencies/LocalModulesHelpers");

module.exports = superclass => class extends superclass {

	addArrayDependency(expr, param, identifiers, namedModule) {
		const {parser} = this;
		if(param.isArray()) {
			param.items.forEach((param, idx) => { // eslint-disable-line no-shadow
				if(param.isString()) {
					if (["require", "module", "exports"].indexOf(param.string) >= 0) {
						if (identifiers) identifiers[idx] = param.string;
					}
				}
				parser.applyPluginsBailResult(`call ${this.verb}:amd:item`, expr, param, namedModule);
			});
			return true;
		} else if(param.isConstArray()) {
			const deps = [];
			param.array.forEach((request, idx) => {
				let dep, localModule;
				if (request === "require") {
					if (identifiers) identifiers[idx] = request;
					dep = "__webpack_require__.dj.c(module.i)";
				} else if (request === "module") {
					if (identifiers) identifiers[idx] = request;
					dep = "__webpack_require__.dj.m(module)";
				} else if(request === "exports") {
					if (identifiers) identifiers[idx] = request;
					dep = request;
				} else if(localModule = LocalModulesHelpers.getLocalModule(parser.state, request)) { // eslint-disable-line no-cond-assign
					dep = new LocalModuleDependency(localModule);
					dep.loc = expr.loc;
					parser.state.current.addDependency(dep);
				} else {
					var dojoRequire = parser.state.compilation.compiler.applyPluginsBailResult("get dojo require");
					const props = {options: this.options, require:dojoRequire};
					if (this.verb === "require" && parser.scope.renames["$"+expr.callee.name] !== "require") {
						props.usingGlobalRequire = true;
					}
					dep = this.newRequireItemDependency(request, parser.state.current, props);
					dep.loc = expr.loc;
					dep.optional = !!parser.scope.inTry;
					parser.state.current.addDependency(dep);
				}
				deps.push(dep);
			});
			const dep = this.newRequireArrayDependency(deps, param.range);
			dep.loc = expr.loc;
			dep.optional = !!parser.scope.inTry;
			parser.state.current.addDependency(dep);
			return true;
		}
	}

	addItemDependency(expr, param, namedModule) {
		const {parser} = this;
		if(param.isString()) {
			let dep, localModule;
			if (param.string === "require") {
				dep = new ConstDependency("__webpack_require__.dj.c(module.i)", param.range);
			} else if (param.string === "module") {
				dep = new ConstDependency("__webpack_require__.dj.m(module)", param.range);
			} else if (param.string === "exports") {
				dep = new ConstDependency(param.string, param.range);
			} else if(localModule = LocalModulesHelpers.getLocalModule(parser.state, param.string, namedModule)) { // eslint-disable-line no-cond-assign
				dep = new LocalModuleDependency(localModule, param.range);
			} else {
				var dojoRequire = parser.state.compilation.compiler.applyPluginsBailResult("get dojo require");
				const props = {options:this.options, require:dojoRequire};
				if (this.verb === "require" && parser.scope.renames["$"+expr.callee.name] !== "require") {
					props.usingGlobalRequire = true;
				}
				dep = this.newRequireItemDependency(param.string, parser.state.current, props, param.range);
			}
			dep.loc = expr.loc;
			dep.optional = !!parser.scope.inTry;
			parser.state.current.addDependency(dep);
		} else {
			const req = (this.verb === "define") ? '__webpack_require__.dj.c(module.i)' : expr.callee.name;
			var dep = new ConstDependency(`${req}(`, [param.range[0], param.range[0]]);
			dep.loc = {start:expr.loc.start, end:expr.loc.start};
			dep.optional = !!parser.scope.inTry;
			parser.state.current.addDependency(dep);
			dep = new ConstDependency(",null,false)", [param.range[1], param.range[1]]);
			dep.loc = {start:expr.loc.end, end:expr.loc.end};
			dep.optional = !!parser.scope.inTry;
			parser.state.current.addDependency(dep);
		}
		return true;
	}

	newRequireArrayDependency(deps, range, props) {
		return new DojoAMDRequireArrayDependency(deps, range, props);
	}
	newRequireItemDependency(expr, module, props, range) {
		return new DojoAMDRequireItemDependency(expr, module, props, range);
	}
};