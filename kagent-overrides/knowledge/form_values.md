# Form initial values configuration

The Form widget supports the **`initialValues`** property, which allows form fields to load initial values for already compiled forms.

This property is useful when form values need to be displayed or edited after being submitted.

> [!NOTE]
> `initialValues` should not be confused with Form fields `default` values, which are usually defined using the `stringSchema` property and represent fallback values. `initialValues` are explicitly provided to represent the starting state of the form, taking precedence over `default` values but not over user-entered values.

Initial values must be defined as children of the `initialValues` property, typically using a key-value structure that mirrors the form schema paths.

Since the Form cannot know the correct value format in advance, it is the responsibility of the YAML author to provide values that match the expected field type. If a value does not match the expected type, the frontend logic will attempt to coerce it to a valid format when possible. If coercion is not possible, the value will be ignored and the field will be cleared.

When an initial value is ignored or cleared due to an invalid format, a warning will be logged in the browser console. If an initial value is defined but not displayed, this is almost always due to an invalid value format.

If a default value is defined in the JSON Schema, the `initialValues` entry (if present) will always override it.

------------------------------------------------------------------------

## Example (YAML)

### Schema

``` yaml
schema:
  type: object
  properties:
    enableMetrics:
      type: boolean
      title: Enable Metrics
      default: true
    name:
      type: string
      title: Application Name
    replicas:
      type: integer
      title: Number of Replicas
      default: 2
```

### Initial values

``` yaml
initialValues:
  enableMetrics: true
  name: initial-name
  replicas: 5
```

When opening the Form:
- `enableMetrics` will be set to `true`
- `name` will display `initial-name`
- `replicas` will be set to `5` (overriding the schema default value of `2`)

For additional and expanded examples, refer to the [Form examples YAML file](../src/examples/widgets/Form/Form.example.yaml).

------------------------------------------------------------------------

## Autocomplete and Dependencies fields

As described in the *[Autocomplete and Dependencies Form fields](./autocomplete-and-dependencies.md)* documentation, the Form widget supports dynamic fields defined via the `autocomplete` and `dependencies` configuration sections.

These field types require a specific value format when setting initial values. Since their options follow the `{ label, value }` structure, their initial values must follow the same format to be correctly displayed and validated.

This structure allows:
- Correct rendering of the selected option
- Separation between display value (`label`) and actual value (`value`)
- Proper execution of dependent API calls

If an initial value is provided but does not match any available option returned by the data source, the value will be cleared and a warning will be logged.

### Example (YAML)

#### Schema

``` yaml
schema:
  type: object
  properties:
    city:
      type: string
    nation:
      type: string
  autocomplete:
    - name: nation
      resourceRefId: getNations
  dependencies:
    - name: city
      dependsOn:
        - name: nation
      resourceRefId: getCities
```

#### Initial values

``` yaml
initialValues:
  nation:
    label: Italy
    value: IT
  city:
    label: Milan
    value: MI
```

In this example:
- The `nation` field will be initialized using theprovided `{ label, value }`
- The `city` field will only be kept if it exists among the options returned for the selected nation