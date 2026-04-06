# Autocomplete and Dependencies Form fields Configuration

The Form widget supports two types of dynamic field configurations — **`autocomplete`** and **`dependencies`** — which allow form fields to dynamically load selectable options retrieved using Krateo [`RESTActions`](restactions.md).

Both `autocomplete` and `dependencies` rely on **resource references** defined elsewhere in the configuration (under `resourcesRefs`).  
Each reference points to a specific **RESTAction**, which defines the base API path.

When triggered, the form engine constructs the full API URL, attaches any `extras` parameters (such as the value selected or searched), and expects a JSON response containing a `status` array in the `{ label, value }` format.

---

## Autocomplete

### Description

The `autocomplete` property allows configuration of fields that suggest or fetch possible values as the user types.  
Each item in the `autocomplete` array describes a single field that will use this dynamic lookup behavior.

When configured, the form engine automatically renders an autocomplete input that:
- Uses **static enum values** from the schema, if available, or
- Calls a **RESTAction** defined via `resourceRefId` when the user starts typing. An `extra` parameter can be configured to set an additional key which will be used as query parameter.

### Example (YAML)

```yaml
autocomplete:
  - name: city
    resourceRefId: getCities
    extra:
      key: cityName
```

RESTAction definition example:

```yaml
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata:
  name: getCities
  namespace: demo-system
spec:
  api:
  - headers:
    - 'Accept: application/json'
    name: getCities
    path: ${ "/cities?name=" + (.cityName) }
    verb: GET
    filter: "[ .getCities[] | { label: .name, value: .name } ]"
    endpointRef:
      name: test-endpoint
      namespace: demo-system
  filter: .getCities
```

Secret definition example:

```yaml
apiVersion: v1
kind: Secret
type: Opaque
metadata:
  name: test-endpoint
  namespace: demo-system
stringData:
  server-url: https://test.com
```

### Behavior

- If the field `city` has an `enum` defined in the schema, those values are displayed as static options.
- If no `enum` is defined, the widget performs a GET request to the RESTAction referenced by `getCities`, appending a query parameter:
  ```
  ?extras={"cityName": "<user_input>"}
  ```
- The RESTAction must return a JSON object containing a `status` array of `{ label, value }` objects.

Example expected response:
```json
{
  "status": [
    { "label": "Rome", "value": "rome" },
    { "label": "Milan", "value": "milan" }
  ]
}
```

---

## Dependencies

### Description

The `dependencies` property allows you to define fields whose available options depend on the value of another field.  
This is typically used for cascading selects, such as choosing a **province** after selecting a **region**.

Unlike `autocomplete`, dependency-based fields **always** use API calls and do not support static enum options.

### Example (YAML)

```yaml
dependencies:
  - name: province
    dependsOn:
      name: region
    resourceRefId: getProvinces
    extra:
      key: regionCode
```

RESTAction definition example:

```yaml
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata:
  name: getProvinces
  namespace: demo-system
spec:
  api:
  - headers:
    - 'Accept: application/json'
    name: getProvinces
    path: ${ "/province/" + (.regionCode) }
    verb: GET
    filter: "[.getProvinces[] | { label: .name, value: .name } ]"
    endpointRef:
      name: test-endpoint
      namespace: demo-system
  filter: .getProvinces
```

Secret definition example:

```yaml
apiVersion: v1
kind: Secret
type: Opaque
metadata:
  name: test-endpoint
  namespace: demo-system
stringData:
  server-url: https://test.com
```

### Behavior

- When the **region** field changes, the form automatically clears the value of **province** and triggers a new API call.
- The form engine calls the RESTAction referenced by `provincesResource`, passing the selected region as an extra query parameter:
  ```
  ?extras={"regionCode": "<selected_region_value>"}
  ```
- The RESTAction must return a JSON object containing a `status` array with `{ label, value }` objects.

Example expected response:
```json
{
  "status": [
    { "label": "Verona", "value": "verona" },
    { "label": "Padua", "value": "padua" }
  ]
}
```