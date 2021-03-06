/*
 * (C) Copyright HCL Technologies Ltd. 2018
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
const {pluginName} = require("./DojoAMDPlugin");
const DojoAMDRequireDependency = require("./DojoAMDRequireDependency");
const DojoAMDDependencyParserMixin = require("./DojoAMDDependencyParserMixin");
const AMDRequireDependenciesBlockParserPlugin = require("webpack/lib/dependencies/AMDRequireDependenciesBlockParserPlugin");

module.exports = class DojoAMDRequireDependenciesBlockParserPlugin extends
DojoAMDDependencyParserMixin(AMDRequireDependenciesBlockParserPlugin) {
	constructor(options) {
		super({});
		this.options = options;
		this.verb = "require";
	}

	apply(parser) {
		parser.hooks.call.for('require').tap(pluginName, this.processCallRequire.bind(this, parser));
		parser.hooks.callMemberChain.for('require').tap(pluginName, this.processCallRequire.bind(this, parser));
		parser.hooks.callMemberChainOfCallMemberChain.for('require').tap(pluginName, (expr__, calleeMembers__, call) => this.processCallRequire(parser, call));
		parser.hooks.expression.for('require').tap(pluginName, () => true);
		parser.hooks.canRename.for('require').tap(pluginName, () => false);

	}

	newRequireDependency(...args) {
		return new DojoAMDRequireDependency(...args);
	}
};
