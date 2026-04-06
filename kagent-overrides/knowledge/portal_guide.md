# Widgets

In Krateo Composable Portal everything is based on the concept of widgets and their composition, a widget is a k8s CRD that maps to a UI element in the frontend (eg a Button) or to a configuration used by other widget (eg a Route)

[see all widgets](./widgets-api-reference.md)

## Anatomy of a widget

A widget source of truth is a JSON schema that is used to generate a CRD, this allow each widget to have it's own Kind and schema validation at the moment of apply
example: [src/widgets/Button/Button.schema.json](/src/widgets/Button/Button.schema.json)

## widgetData

Every widget has a `widgetData` property that contains data used to control how the widget looks like or behave in the Frontend Composable Portal, in this example we are defining a `label`, an `icon` (using [fontawesome](https://fontawesome.com/search?ip=classic&s=solid&o=r) naming convention) and a `type` that control the the visual style of the button, in the button [API references](./widgets-api-reference.md) can be seen all possible values.

Let's explore a basic Button widget

```
# button.yaml
kind: Button
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: button-1
  namespace: krateo-system
spec:
  widgetData:
    label: This is a button
    icon: fa-sun
    type: primary
```

## widgetDataTemplate

Every widget supports the property `spec.widgetDataTemplate` that allows overriding a specific value defined in `spec.widgetData`, this is useful to inject dynamic content inside a widget.

```
 widgetDataTemplate:
    - forPath: data
      expression: ${ .namespaces }
```

`widgetDataTemplate` accepts an array of objects with `forPath` and `expression` keys.

`forPath` is used to chose what key in `widgetData` to override, it uses dot notation to reference nested data eg `parentProperty.childProperty`

`expression` is a [jq](https://jqlang.org/) expression that uses the result of the jq expression as the data to be injected in the specified path

### Simple example

In the example below, the label of the button will be the date when the widget is loaded, as the data from widgetDataTemplate is substituted dynamically at the moment of loading a widget

```
kind: Button
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: button-post-nginx
  namespace: krateo-system
spec:
  widgetData:
    label: button 1
    icon: fa-rocket
    type: primary
  widgetDataTemplate:
    - forPath: label
      expression: ${ now | strftime("%Y-%m-%d") }
```

### Complete example

```
kind: Table
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: table-of-namespaces
  namespace: krateo-system
spec:
  widgetData:
    pageSize: 10
    data: []
    columns:
      - valueKey: name
        title: Cluster Namespaces

  widgetDataTemplate:
    - forPath: data
      expression: ${ .namespaces }
  apiRef:
    name: cluster-namespaces
    namespace: krateo-system


---
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata:
  name: cluster-namespaces
  namespace: krateo-system
spec:
  api:
  - name: namespaces
    path: "/api/v1/namespaces"
    filter: "[.items[] | {name: .metadata.name}]"
```

In the example above, we declared a table with a single column `name` to display all namespaces of the cluster.
The data is loaded directly from the k8s api server

### How does it work?

```
widgetDataTemplate:
    - forPath: data
      expression: ${ .namespaces }
```

What is `.namespaces`?

In the expression `.namespace` reference the result of an api called `namespaces`.

The Table widget has a field `spec.apiRef` that references a RESTAction by name (`cluster-namespaces`), an `api` with name `namespaces` is declared in the RESTAction's `spec.api` array

By this chain of references `Widget -> apiRef -> RESTAction -> api` widgetDataTemplate is able to refecence an api by name

```
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata:
  name: cluster-namespaces
  namespace: krateo-system
spec:
  api:
  - name: namespaces
    path: "/api/v1/namespaces"
    filter: "[.items[] | {name: .metadata.name}]"
```

As shown above, the endpoint called is `/api/v1/namespaces` which call the k8s api server, if this were an absolute URL it could reference external APIs, see the [RESTActions documentation](./restactions.md) for more details and learning how to authenticate to external APIs

## actions

Actions are a way to declare widget behavious and user interactions.

The currencly supported actions are:

- rest
- navigate
- openDrawer
- openModal

Widgets can define actions inside widgetData

### Rest Action

Used to trigger an HTTP request to a specified resource (mathing the resourceRefId)

| Property                         | Type    | Required | Description                                                          | Additional Info                    |
| -------------------------------- | ------- | -------- | -------------------------------------------------------------------- | ---------------------------------- |
| payloadKey                       | string  | No       | Key used to nest the payload in the request body                     |                                    |
| id                               | string  | No       | Unique identifier for the action                                     |                                    |
| resourceRefId                    | string  | No       | The identifier of the k8s custom resource that should be represented |                                    |
| requireConfirmation              | boolean | No       | Whether user confirmation is required before triggering the action   |                                    |
| onSuccessNavigateTo              | string  | No       | URL to navigate to after successful execution                        |                                    |
| onEventNavigateTo                | object  | No       | Conditional navigation triggered by a specific event                 | additionalProperties: false        |
| onEventNavigateTo.eventReason    | string  | Yes      | Identifier of the awaited event reason                               |                                    |
| onEventNavigateTo.url            | string  | Yes      | URL to navigate to when the event is received                        |                                    |
| onEventNavigateTo.timeout        | integer | No       | The timeout in seconds to wait for the event                         | Default: 50                        |
| onEventNavigateTo.loadingMessage | string  | No       | Message to display while waiting for the event                       |                                    |
| loading                          | string  | No       | Defines the loading indicator behavior for the action                | Enum: ["global", "inline", "none"] |
| type                             | string  | No       | Type of action to execute                                            | Enum: ["rest"]                     |
| payload                          | object  | No       | Static payload sent with the request                                 | additionalProperties: true         |
| payloadToOverride                | array   | No       | List of payload fields to override dynamically                       | Array of objects                   |
| payloadToOverride.name           | string  | Yes      | Name of the field to override                                        |                                    |
| payloadToOverride.value          | string  | Yes      | Value to use for overriding the field                                |                                    |

#### Example

This is an example of a button that when clicked, creates a new nginx pod named `my-nginx`

```
kind: Button
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: button-post-nginx
  namespace: krateo-system
spec:
  widgetData:
    label: button 1
    icon: fa-rocket
    type: primary
    clickActionId: action-1
    actions:
      rest:
        - id: action-1
          resourceRefId: resource-ref-1
          type: rest
          payload:
            apiVersion: v1
            kind: Pod
            metadata:
              name: nginx-pod-789
            spec:
              containers:
                - image: 'nginx:latest'
                  name: nginx
                  ports:
                    - containerPort: 80

  resourcesRefs:
    - id: resource-ref-1
      apiVersion: v1
      resource: pods
      name: my-nginx
      namespace: krateo-system
      verb: POST
```

### Navigate action

Navigate to a different URL

| Property            | Type    | Required | Description                                                          | Additional Info                    |
| ------------------- | ------- | -------- | -------------------------------------------------------------------- | ---------------------------------- |
| id                  | string  | No       | Unique identifier for the action                                     |                                    |
| type                | string  | No       | Type of navigation action                                            | Enum: ["navigate"]                 |
| name                | string  | No       | Name of the navigation action                                        |                                    |
| resourceRefId       | string  | No       | The identifier of the k8s custom resource that should be represented |                                    |
| requireConfirmation | boolean | No       | Whether user confirmation is required before navigating              |                                    |
| loading             | string  | No       | Defines the loading indicator behavior during navigation             | Enum: ["global", "inline", "none"] |

### OpenDrawer action

Display another widget, referenced by resourceRefId inside a drawer (side panel)

| Property            | Type    | Required | Description                                                          | Additional Info                    |
| ------------------- | ------- | -------- | -------------------------------------------------------------------- | ---------------------------------- |
| id                  | string  | No       | Unique identifier for the drawer action                              |                                    |
| type                | string  | No       | Type of drawer action                                                | Enum: ["openDrawer"]               |
| resourceRefId       | string  | No       | The identifier of the k8s custom resource that should be represented |                                    |
| requireConfirmation | boolean | No       | Whether user confirmation is required before opening                 |                                    |
| loading             | string  | No       | Defines the loading indicator behavior for the drawer                | Enum: ["global", "inline", "none"] |
| size                | string  | No       | Drawer size to be displayed                                          | Enum: ["default", "large"]         |
| title               | string  | No       | Title shown in the drawer header                                     |                                    |

### OpenModal action

Display another widget, referenced by resourceRefId inside a modal

| Property            | Type    | Required | Description                                                          | Additional Info                    |
| ------------------- | ------- | -------- | -------------------------------------------------------------------- | ---------------------------------- |
| id                  | string  | No       | Unique identifier for the modal action                               |                                    |
| type                | string  | No       | Type of modal action                                                 | Enum: ["openModal"]                |
| name                | string  | No       | Name of the modal action                                             |                                    |
| resourceRefId       | string  | No       | The identifier of the k8s custom resource that should be represented |                                    |
| requireConfirmation | boolean | No       | Whether user confirmation is required before opening                 |                                    |
| loading             | string  | No       | Defines the loading indicator behavior for the modal                 | Enum: ["global", "inline", "none"] |
| title               | string  | No       | Title shown in the modal header                                      |                                    |

## composing widgets

In order to compose complex and more powetful UIs, widgets needs a way to reference other widgets and RESTActions, this is possible via the `spec.resourcesRefs` property

### resourcesRefs

```
kind: Row
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: my-row
  namespace: krateo-system
spec:
  widgetData:
    items:
      - resourceRefId: pie-chart-inside-column
        size: 6
      - resourceRefId: table-of-pods
        size: 18
  resourcesRefs:
    - id: table-of-pods
      apiVersion: widgets.templates.krateo.io/v1beta1
      name: table-of-pods
      namespace: krateo-system
      resource: tables
      verb: GET
    - id: pie-chart-inside-column
      apiVersion: widgets.templates.krateo.io/v1beta1
      name: pie-chart-inside-column
      namespace: krateo-system
      resource: piecharts
      verb: GET
```

In the example above we can see `resourcesRefs` declaring a list of other resources and a user-defined ID. A widget of kind `Row` use a matching ID to reference and display other resource, in this example it will display the items in order or declaration, `pie-chart-inside-column` on top and `table-of-pods` below regardless of the order of the resourcesRefs.

### resourcesRefsTemplate

Similar to `widgetDataTemplate`, `resourcesRefsTemplate` allows to populate `resourcesRefs` with dynamic data coming from an `api`

```
kind: Row
apiVersion: widgets.templates.krateo.io/v1beta1
metadata:
  name: templates-row
  namespace: my-namespace
spec:
  apiRef:
    name: templates-panels
    namespace: my-namespace
  widgetData:
    items: []
  widgetDataTemplate:
    - forPath: items
      expression: >
        ${ [ .templatespanels[] | { resourceRefId: .metadata.name, size: 12 } ] }
  resourcesRefs: []
  resourcesRefsTemplate:
    - iterator: ${ .templatespanels }
      template:
        id: ${ .metadata.name }
        apiVersion: ${ .apiVersion }
        resource: panels
        namespace: ${ .metadata.namespace }
        name: ${ .metadata.name }
        verb: GET
```

In the example above `resourcesRefsTemplate` declares an iterator, that loop over the result of an api called `templatespanels` and populate resourcesRefs with it.
if `resourcesRefs` has some manually filled items they will be merged with the result of resourcesRefsTemplate

As a quick recap of what is happing:

- the widget references a RESTAction with name templates-panels in `apiRef`
- templates-panels RESTAction declares an api called `templatespanels`
- resourcesRefsTemplate's iterator uss the result of `templatespanels` to populate them items that will be part of resourcesRefs

### Widgets API reference

An api reference listing all widgets and their `widgetData` is available at [widgets-api-reference.md](./widgets-api-reference.md)
