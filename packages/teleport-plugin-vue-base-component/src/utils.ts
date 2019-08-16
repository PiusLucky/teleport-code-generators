import * as types from '@babel/types'

import {
  objectToObjectExpression,
  convertValueToLiteral,
  ParsedASTNode,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import {
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLEventHandlerStatement,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

export const extractStateObject = (stateDefinitions: Record<string, UIDLStateDefinition>) => {
  return Object.keys(stateDefinitions).reduce((result, key) => {
    result[key] = stateDefinitions[key].defaultValue
    return result
  }, {})
}

export const generateVueComponentJS = (
  uidl: ComponentUIDL,
  componentDependencies: string[],
  dataObject: Record<string, any>,
  methodsObject: Record<string, UIDLEventHandlerStatement[]>,
  t = types
) => {
  const vueObjectProperties = []

  if (uidl.propDefinitions) {
    const props = createVuePropsDefinition(uidl.propDefinitions)
    const propsAST = objectToObjectExpression(props)
    vueObjectProperties.push(t.objectProperty(t.identifier('props'), propsAST))
  }

  if (componentDependencies.length) {
    const componentsAST = t.objectExpression([
      ...componentDependencies.map((declarationName) => {
        return t.objectProperty(
          t.identifier(declarationName),
          t.identifier(declarationName),
          false,
          true
        )
      }),
    ])
    vueObjectProperties.push(t.objectProperty(t.identifier('components'), componentsAST))
  }

  if (Object.keys(dataObject).length > 0) {
    const dataAST = objectToObjectExpression(dataObject)
    vueObjectProperties.push(
      t.objectMethod(
        'method',
        t.identifier('data'),
        [],
        t.blockStatement([t.returnStatement(dataAST)])
      )
    )
  }

  if (Object.keys(methodsObject).length > 0) {
    const methodsAST = createMethodsObject(methodsObject, uidl.propDefinitions)
    vueObjectProperties.push(
      t.objectProperty(t.identifier('methods'), t.objectExpression(methodsAST))
    )
  }

  return t.exportDefaultDeclaration(
    t.objectExpression([
      t.objectProperty(t.identifier('name'), t.stringLiteral(uidl.name)),
      ...vueObjectProperties,
    ])
  )
}

const createVuePropsDefinition = (
  uidlPropDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  return Object.keys(uidlPropDefinitions).reduce((acc: { [key: string]: any }, name) => {
    let mappedType
    const { type, defaultValue, isRequired } = uidlPropDefinitions[name]
    switch (type) {
      case 'string':
        mappedType = String
        break
      case 'number':
        mappedType = Number
        break
      case 'boolean':
        mappedType = Boolean
        break
      case 'array':
        mappedType = Array
        break
      case 'object':
        mappedType = Object
        break
      case 'func':
        mappedType = Function
        break
      default:
        // don't handle anything else
        throw new Error(
          `createVuePropsDefinition encountered a unknown PropDefinition, ${JSON.stringify(
            uidlPropDefinitions[name]
          )}`
        )
    }

    let defaultPropValue = null

    if (defaultValue !== undefined) {
      defaultPropValue =
        type === 'array' || type === 'object'
          ? new ParsedASTNode(t.arrowFunctionExpression([], convertValueToLiteral(defaultValue)))
          : defaultValue
    }

    acc[name] = defaultPropValue ? { type: mappedType, default: defaultPropValue } : mappedType
    acc[name] = isRequired ? { required: isRequired, ...acc[name] } : acc[name]

    return acc
  }, {})
}

const createMethodsObject = (
  methods: Record<string, UIDLEventHandlerStatement[]>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  return Object.keys(methods).map((eventKey) => {
    const astStatements = []
    methods[eventKey].map((statement) => {
      const astStatement =
        statement.type === 'propCall'
          ? createPropCallStatement(statement, propDefinitions)
          : createStateChangeStatement(statement)

      if (astStatement) {
        astStatements.push(astStatement)
      }
    })
    return t.objectMethod('method', t.identifier(eventKey), [], t.blockStatement(astStatements))
  })
}

const createStateChangeStatement = (statement: UIDLEventHandlerStatement, t = types) => {
  const { modifies, newState } = statement

  const rightOperand =
    newState === '$toggle'
      ? t.unaryExpression('!', t.memberExpression(t.identifier('this'), t.identifier(modifies)))
      : convertValueToLiteral(newState)

  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier('this'), t.identifier(modifies)),
      rightOperand
    )
  )
}

const createPropCallStatement = (
  eventHandlerStatement: UIDLEventHandlerStatement,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  const { calls: propFunctionKey, args = [] } = eventHandlerStatement

  if (!propFunctionKey) {
    console.warn(`No prop definition referenced under the "calls" field`)
    return null
  }

  const propDefinition = propDefinitions[propFunctionKey]

  if (!propDefinition) {
    console.warn(`No prop definition was found for function "${propFunctionKey}"`)
    return null
  }

  // In vue it's favorable to use $emit for a specific event than sending the function as a prop
  return t.expressionStatement(
    t.callExpression(t.identifier('this.$emit'), [
      t.stringLiteral(propFunctionKey),
      ...args.map((arg) => convertValueToLiteral(arg)),
    ])
  )
}
