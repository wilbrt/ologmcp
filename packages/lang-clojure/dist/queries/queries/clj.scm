; Clojure tree-sitter queries for olog element extraction
; Uses node types from @yogthos/tree-sitter-clojure (sogaiu grammar):
;   list_lit = (...)   sym_lit = symbol   kwd_lit = :keyword

; Function definitions: (defn name ...)
(list_lit
  (sym_lit) @_defn
  (sym_lit) @function.name
  (#match? @_defn "^defn-?$"))

; Namespace declarations: (ns name)
(list_lit
  (sym_lit) @_ns
  (sym_lit) @namespace.name
  (#eq? @_ns "ns"))

; Variable definitions: (def name ...)
(list_lit
  (sym_lit) @_def
  (sym_lit) @variable.name
  (#eq? @_def "def"))

; Macro definitions: (defmacro name ...)
(list_lit
  (sym_lit) @_defmacro
  (sym_lit) @function.name
  (#eq? @_defmacro "defmacro"))

; schema.core: (s/defn name ...) and (s/defn- name ...)
(list_lit
  (sym_lit) @_s_defn
  (sym_lit) @function.name
  (#match? @_s_defn "^s/defn-?$"))

; schema.core: (s/defschema Name ...)
(list_lit
  (sym_lit) @_s_defschema
  (sym_lit) @variable.name
  (#eq? @_s_defschema "s/defschema"))

; schema.core: (s/def name ...)
(list_lit
  (sym_lit) @_s_def
  (sym_lit) @variable.name
  (#eq? @_s_def "s/def"))
