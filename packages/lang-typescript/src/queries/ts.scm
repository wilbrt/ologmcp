;; Tested with tree-sitter-typescript 0.23.2 — update queries if upgrading the grammar.

;; --- function_declaration -------------------------------------------------
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation)? @function.return_type
  body: (statement_block) @function.body) @function

;; --- arrow_function (anonymous; use parent for a usable name) -------------
(variable_declarator
  name: (identifier) @function.name
  value: (arrow_function
           parameters: (_) @function.params
           body: (_) @function.body) @function) @function.decl

(export_statement (arrow_function) @function)

(pair
  key: [(property_identifier) (string)] @function.name
  value: (arrow_function) @function)

;; --- method_definition ----------------------------------------------------
(method_definition
  name: (_) @method.name
  parameters: (formal_parameters) @method.params
  return_type: (type_annotation)? @method.return_type
  body: (statement_block)? @method.body) @method

(abstract_method_signature name: (_) @method.name) @method.abstract

;; --- method inside class (for memberOf arrow) -----------------------------
(class_declaration
  name: (type_identifier) @memberof.class
  body: (class_body
    (method_definition
      name: (_) @memberof.method))) @memberof

;; --- class_declaration ----------------------------------------------------
(class_declaration
  name: (type_identifier) @class.name
  type_parameters: (type_parameters)? @class.type_params
  (class_heritage)? @class.heritage
  body: (class_body) @class.body) @class

;; --- interface_declaration ------------------------------------------------
(interface_declaration
  name: (type_identifier) @interface.name
  type_parameters: (type_parameters)? @interface.type_params
  body: (interface_body) @interface.body) @interface

;; --- type_alias_declaration -----------------------------------------------
(type_alias_declaration
  name: (type_identifier) @typealias.name
  type_parameters: (type_parameters)? @typealias.type_params
  value: (_) @typealias.value) @typealias

;; --- enum_declaration -----------------------------------------------------
(enum_declaration
  name: (identifier) @enum.name
  body: (enum_body) @enum.body) @enum

;; --- import_statement -----------------------------------------------------
(import_statement
  (import_clause
    [ (identifier) @import.default
      (namespace_import (identifier) @import.namespace)
      (named_imports
        (import_specifier
          name: (identifier) @import.name
          alias: (identifier)? @import.alias)) ])?
  source: (string (string_fragment) @import.source)) @import

(export_statement
  source: (string (string_fragment) @reexport.source)) @reexport

;; --- call_expression ------------------------------------------------------
(call_expression
  function: (identifier) @call.callee
  arguments: (arguments) @call.args) @call

(call_expression
  function: (member_expression
              object: (_) @call.receiver
              property: (property_identifier) @call.method)
  arguments: (arguments) @call.args) @call.member

(new_expression
  constructor: (_) @new.ctor
  arguments: (arguments)? @new.args) @new

;; --- this.property access (references) ------------------------------------
(member_expression
  object: (this) @ref.this
  property: (property_identifier) @ref.property) @ref.self

;; --- require("x") detection (CJS) ----------------------------------------
((call_expression
  function: (identifier) @_id
  arguments: (arguments (string (string_fragment) @require.source)))
  (#eq? @_id "require"))
