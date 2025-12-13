// ============================================================================
// Service Registry for Graph Visualization
// ============================================================================

import type { Event } from '../events.ts'

export type ServiceMetadata = {
  name: string
  publishes: Array<Event['type']>
  subscribes: Array<Event['type']>
}

export type StateSubscription = {
  from: string
  to: string
  label: string
}

export type GraphStructure = {
  nodes: ServiceMetadata[]
  edges: Array<{
    from: string
    to: string
    eventType: Event['type']
    edgeType: 'event'
  }>
  stateEdges: Array<{
    from: string
    to: string
    label: string
    edgeType: 'state'
  }>
}

const serviceRegistry = new Map<string, ServiceMetadata>()
const stateSubscriptions: StateSubscription[] = []

export function registerService(metadata: ServiceMetadata): void {
  serviceRegistry.set(metadata.name, metadata)
}

export function registerStateSubscription(sub: StateSubscription): void {
  stateSubscriptions.push(sub)
}

export function deriveGraph(): GraphStructure {
  const nodes = Array.from(serviceRegistry.values())
  const edges: GraphStructure['edges'] = []

  // For each service that publishes events
  serviceRegistry.forEach((publisher) => {
    publisher.publishes.forEach((eventType) => {
      // Find all services that subscribe to this event type
      serviceRegistry.forEach((subscriber) => {
        if (subscriber.subscribes.includes(eventType)) {
          edges.push({
            from: publisher.name,
            to: subscriber.name,
            eventType,
            edgeType: 'event'
          })
        }
      })
    })
  })

  const stateEdges = stateSubscriptions.map(sub => ({
    ...sub,
    edgeType: 'state' as const
  }))

  return { nodes, edges, stateEdges }
}

export function getServiceRegistry(): Map<string, ServiceMetadata> {
  return serviceRegistry
}
