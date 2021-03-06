// Copyright 2012 The Closure Library Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Provides a mocking framework in Closure to make unit tests easy
 * to write and understand. The methods provided here can be used to replace
 * implementations of existing objects with 'mock' objects to abstract out
 * external services and dependencies thereby isolating the code under test.
 * Apart from mocking, methods are also provided to just monitor calls to an
 * object (spying) and returning specific values for some or all the inputs to
 * methods (stubbing).
 *
 */


goog.provide('goog.labs.mock');

goog.require('goog.array');
goog.require('goog.debug.Error');
goog.require('goog.functions');


/**
 * Mocks a given object or class.
 *
 * @param {!Object} objectOrClass An instance or a constructor of a class to be
 *     mocked.
 *
 * @return {!Object} The mocked object.
 */
goog.labs.mock = function(objectOrClass) {
  // Go over properties of 'objectOrClass' and create a MockManager to
  // be used for stubbing out calls to methods.
  var mockObjectManager = new goog.labs.mock.MockObjectManager_(objectOrClass);
  var mockedObject = mockObjectManager.getMockedItem();
  goog.asserts.assertObject(mockedObject);
  return /** @type {!Object} */ (mockedObject);
};


/**
 * Mocks a given function.
 *
 * @param {!Function} func A function to be mocked.
 *
 * @return {!Function} The mocked function.
 */
goog.labs.mockFunction = function(func) {
  var mockFuncManager = new goog.labs.mock.MockFunctionManager_(func);
  var mockedFunction = mockFuncManager.getMockedItem();
  goog.asserts.assertFunction(mockedFunction);
  return /** @type {!Function} */ (mockedFunction);
};


/**
 * This array contains the name of the functions that are part of the base
 * Object prototype.
 * Basically a copy of goog.object.PROTOTYPE_FIELDS_.
 * @const
 * @type {!Array.<string>}
 * @private
 */
goog.labs.mock.PROTOTYPE_FIELDS_ = [
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf'
];



/**
 * Base class that provides basic functionality for creating, adding and
 * finding bindings, offering an executor method that is called when a call to
 * the stub is made, an array to hold the bindings and the mocked item, among
 * other things.
 *
 * @constructor
 * @private
 */
goog.labs.mock.MockManager_ = function() {
  /**
   * Proxies the methods for the mocked object or class to execute the stubs.
   * @type {!Object}
   * @protected
   * TODO(user): make instanceof work.
   */
  this.mockedItem = {};

  /**
   * Holds the stub bindings established so far.
   * @protected
   */
  this.methodBindings = [];

  /**
   * Holds a reference to the binder used to define stubs.
   * @protected
   */
  this.$stubBinder = null;
};


/**
 * Handles the first step in creating a stub, returning a stub-binder that
 * is later used to bind a stub for a method.
 *
 * @param {string} methodName The name of the method being bound.
 * @param {...} var_args The arguments to the method.
 *
 * @return {!goog.labs.mock.StubBinder_} The stub binder.
 * @private
 */
goog.labs.mock.MockManager_.prototype.handleMockCall_ =
    function(methodName, var_args) {
  var args = goog.array.slice(arguments, 1);
  return new goog.labs.mock.StubBinder_(this, methodName, args);
};


/**
 * Returns the mock object. This should have a stubbed method for each method
 * on the object being mocked.
 *
 * @return {!Object|!Function} The mock object.
 */
goog.labs.mock.MockManager_.prototype.getMockedItem = function() {
  return this.mockedItem;
};


/**
 * Adds a binding for the method name and arguments to be stubbed.
 *
 * @param {?string} methodName The name of the stubbed method.
 * @param {!Array} args The arguments passed to the method.
 * @param {!Function} func The stub function.
 *
 */
goog.labs.mock.MockManager_.prototype.addBinding =
    function(methodName, args, func) {
  var binding = new goog.labs.mock.MethodBinding_(methodName, args, func);
  this.methodBindings.push(binding);
};


/**
 * Returns a stub, if defined, for the method and arguments passed in as
 * parameters.
 *
 * @param {string} methodName The name of the stubbed method.
 * @param {Array} args The arguments passed to the method.
 *
 * @return {!Function|undefined} The stub function or undefined.
 * @private
 */
goog.labs.mock.MockManager_.prototype.findBinding_ =
    function(methodName, args) {
  var stub = goog.array.find(this.methodBindings, function(binding) {
    return binding.matches(methodName, args);
  });
  return stub && stub.getStub();
};


/**
 * Looks up the list of stubs defined on the mock object and executes the
 * function associated with that stub.
 *
 * @param {string} methodName The name of the method to execute.
 * @param {...} var_args The arguments passed to the method.
 *
 * @return {*} Value returned by the stub function.
 * @private
 */
goog.labs.mock.MockManager_.prototype.executeStub_ =
    function(methodName, var_args) {
  var args = goog.array.slice(arguments, 1);
  var func = this.findBinding_(methodName, args);
  if (func) {
    return func.apply(null, args);
  }
};



/**
 * Sets up mock for the given object (or class), stubbing out all the defined
 * methods. By default, all stubs return {@code undefined}, though stubs can be
 * later defined using {@code goog.labs.mock.when}.
 *
 * @param {!Object|!Function} objOrClass The object or class to set up the mock
 *     for. A class is a constructor function.
 *
 * @constructor
 * @extends {goog.labs.mock.MockManager_}
 * @private
 */
goog.labs.mock.MockObjectManager_ = function(objOrClass) {
  goog.base(this);

  /**
   * Proxies the calls to establish the first step of the stub bindings (object
   * and method name)
   * @private
   */
  this.objectStubBinder_ = {};

  var obj;
  if (goog.isFunction(objOrClass)) {
    // Create a temporary subclass with a no-op constructor so that we can
    // create an instance and determine what methods it has.
    /** @constructor */
    function tempCtor() {};
    goog.inherits(tempCtor, objOrClass);
    obj = new tempCtor();
  } else {
    obj = objOrClass;
  }

  var enumerableProperties = goog.object.getKeys(obj);
  // The non enumerable properties are added due to the fact that IE8 does not
  // enumerate any of the prototype Object functions even when overriden and
  // mocking these is sometimes needed.
  for (var i = 0; i < goog.labs.mock.PROTOTYPE_FIELDS_.length; i++) {
    var prop = goog.labs.mock.PROTOTYPE_FIELDS_[i];
    if (!goog.array.contains(enumerableProperties, prop)) {
      enumerableProperties.push(prop);
    }
  }

  // Adds the properties to the mock, creating a proxy stub for each method on
  // the instance.
  for (var i = 0; i < enumerableProperties.length; i++) {
    var prop = enumerableProperties[i];
    if (goog.isFunction(obj[prop])) {
      this.mockedItem[prop] = goog.bind(this.executeStub_, this, prop);
      // The stub binder used to create bindings.
      this.objectStubBinder_[prop] =
          goog.bind(this.handleMockCall_, this, prop);
    }
  }
  // The alias for stub binder exposed to the world.
  this.mockedItem.$stubBinder = this.objectStubBinder_;
};
goog.inherits(goog.labs.mock.MockObjectManager_,
              goog.labs.mock.MockManager_);



/**
 * Sets up mock for the given function, stubbing out. By default, all stubs
 * return {@code undefined}, though stubs can be later defined using
 * {@code goog.labs.mock.when}.
 *
 * @param {!Function} func The function to set up the mock for.
 *
 * @constructor
 * @extends {goog.labs.mock.MockManager_}
 * @private
 */
goog.labs.mock.MockFunctionManager_ = function(func) {
  goog.base(this);

  /**
   * The stub binder used to create bindings.
   * @type {!Function}
   * @private
   */
  this.functionStubBinder_ = goog.bind(this.handleMockCall_, this, null);
  /**
   * The alias for stub binder exposed to the world.
   * @type {!Function}
   */
  this.$stubBinder = this.functionStubBinder_;

  this.mockedItem = goog.bind(this.executeStub_, this, null);
  this.mockedItem.$stubBinder = this.$stubBinder;
};
goog.inherits(goog.labs.mock.MockFunctionManager_,
              goog.labs.mock.MockManager_);



/**
 * The stub binder is the object that helps define the stubs by binding
 * method name to the stub method.
 *
 * @param {!goog.labs.mock.MockManager_}
 *   mockManager The mock manager.
 * @param {?string} name The method name.
 * @param {!Array} args The other arguments to the method.
 *
 * @constructor
 * @private
 */
goog.labs.mock.StubBinder_ = function(mockManager, name, args) {
  /**
   * The mock manager instance.
   * @type {!goog.labs.mock.MockManager_}
   * @private
   */
  this.mockManager_ = mockManager;

  /**
   * Holds the name of the method to be bound.
   * @type {?string}
   * @private
   */
  this.name_ = name;

  /**
   * Holds the arguments for the method.
   * @type {!Array}
   * @private
   */
  this.args_ = args;
};


/**
 * Defines the stub to be called for the method name and arguments bound
 * earlier.
 * TODO(user): Add support for the 'Answer' interface.
 *
 * @param {!Function} func The stub.
 */
goog.labs.mock.StubBinder_.prototype.then = function(func) {
  this.mockManager_.addBinding(this.name_, this.args_, func);
};


/**
 * Defines the stub to return a specific value for a method name and arguments.
 *
 * @param {*} value The value to return.
 */
goog.labs.mock.StubBinder_.prototype.thenReturn = function(value) {
  this.mockManager_.addBinding(this.name_, this.args_,
                               goog.functions.constant(value));
};


/**
 * Facilitates (and is the first step in) setting up stubs. Obtains an object
 * on which, the method to be mocked is called to create a stub. Sample usage:
 *
 * var mockObj = goog.labs.mock(objectBeingMocked);
 * goog.labs.mock.when(mockObj).getFoo(3).thenReturn(4);
 *
 * @param {!Object} mockObject The mocked object.
 *
 * @return {!goog.labs.mock.StubBinder_} The property binder.
 */
goog.labs.mock.when = function(mockObject) {
  goog.asserts.assert(mockObject.$stubBinder, 'Stub binder cannot be null!');
  return mockObject.$stubBinder;
};



/**
 * Represents a binding between a method name, args and a stub.
 *
 * @param {?string} methodName The name of the method being stubbed.
 * @param {!Array} args The arguments passed to the method.
 * @param {!Function} stub The stub function to be called for the given method.
 * @constructor
 * @private
 */
goog.labs.mock.MethodBinding_ = function(methodName, args, stub) {
  /**
   * The name of the method being stubbed.
   * @type {?string}
   * @private
   */
  this.methodName_ = methodName;

  /**
   * The arguments for the method being stubbed.
   * @type {!Array}
   * @private
   */
  this.args_ = args;

  /**
   * The stub function.
   * @type {!Function}
   * @private
   */
  this.stub_ = stub;
};


/**
 * @return {!Function} The stub to be executed.
 */
goog.labs.mock.MethodBinding_.prototype.getStub = function() {
  return this.stub_;
};


/**
 * Determines whether the given args match the stored args_. Used to determine
 * which stub to invoke for a method.
 *
 * @param {string} methodName The name of the method being stubbed.
 * @param {!Array} args An array of arguments.
 * @return {boolean} If it matches the stored arguments.
 */
goog.labs.mock.MethodBinding_.prototype.matches = function(methodName, args) {
  //TODO(user): More elaborate argument matching.
  return this.methodName_ == methodName &&
         goog.array.equals(args, this.args_);
};
