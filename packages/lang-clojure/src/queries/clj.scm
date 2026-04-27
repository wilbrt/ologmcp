; Clojure tree-sitter queries for olog element extraction
; NOTE: tree-sitter-clojure has limited named node types compared to TypeScript.
; Most structural recognition happens programmatically in extract.ts.
; These queries capture what they can; the programmatic walker fills in the rest.

; Function definitions: (defn name ...)
(list
  (symbol) @_defn
  (symbol) @function.name
  (#match? @_defn "^defn-?$"))

; Private function definitions: (defn- name ...)
(list
  (symbol) @_defn_priv
  (symbol) @function.name
  (#eq? @_defn_priv "defn-"))

; Namespace declarations: (ns name)
(list
  (symbol) @_ns
  (symbol) @namespace.name
  (#eq? @_ns "ns"))

; Variable definitions: (def name ...)
(list
  (symbol) @_def
  (symbol) @variable.name
  (#eq? @_def "def"))

; Macro definitions: (defmacro name ...)
(list
  (symbol) @_defmacro
  (symbol) @function.name
  (#eq? @_defmacro "defmacro"))

; Imports via require in ns forms: (:require [lib :as alias]
; This is a simplified pattern — Clojure require forms are complex
(list
  (symbol) @_require
  (list
    (kwd) @_require_kw
    .
    (_)+
  )
  (#eq? @_require "ns")
)
