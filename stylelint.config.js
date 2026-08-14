/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-recess-order"],
  rules: {
    "alpha-value-notation": "percentage",
    "color-function-notation": "modern",
    "color-named": "never",
    "custom-property-pattern": "^([a-z][a-z0-9]*)(-[a-z0-9]+)*$",
    "declaration-block-no-redundant-longhand-properties": true,
    "declaration-no-important": true,
    "declaration-property-value-allowed-list": {
      "font-weight": ["/^[1-9]00$/"],
    },
    "declaration-property-value-no-unknown": true,
    "font-weight-notation": "numeric",
    "max-nesting-depth": 2,
    "number-max-precision": 2,
    "selector-class-pattern": "^([a-z][a-z0-9]*)(-[a-z0-9]+)*$",
    "selector-max-id": 0,
    "selector-max-specificity": ["0,3,1"],
    "selector-max-type": 2,
    "shorthand-property-no-redundant-values": true,
    "unit-allowed-list": ["px", "%", "em", "rem", "fr"],
  },
};
