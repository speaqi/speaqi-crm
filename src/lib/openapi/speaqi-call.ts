export function createSpeaqiCallOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Speaqi Call CRM API',
      version: '1.0.0',
      description:
        'Documentazione OpenAPI per l’integrazione di Speaqi Call con il CRM. ' +
        'Gli endpoint coprono lead management, activity logging, memoria AI, next action e follow-up automatici.',
    },
    servers: [
      {
        url: origin,
        description: 'Current environment',
      },
    ],
    tags: [
      { name: 'Health', description: 'Endpoint di diagnostica base' },
      { name: 'Leads', description: 'CRUD e orchestration dei lead CRM' },
      { name: 'Activities', description: 'Timeline eventi e outcome delle interazioni' },
      { name: 'Tasks', description: 'Task, next action e follow-up operativi' },
      { name: 'AI', description: 'Classificazione, scoring, memoria e next-action engine' },
      { name: 'Automation', description: 'Trigger schedulati filtrabili per category/source' },
      { name: 'Inbound', description: 'Webhook di ingresso lead da Speaqi o sistemi esterni' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Token JWT Supabase dell’utente. Necessario per tutti gli endpoint user-scoped.',
        },
        AutomationSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'x-automation-secret',
          description: 'Secret per le automazioni server-to-server.',
        },
        WebhookSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'x-webhook-secret',
          description: 'Secret per webhook inbound verso il CRM.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          additionalProperties: false,
          properties: {
            error: { type: 'string' },
          },
          required: ['error'],
        },
        Lead: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: ['string', 'null'], format: 'email' },
            phone: { type: ['string', 'null'] },
            name: { type: 'string' },
            category: { type: ['string', 'null'], example: 'vinitaly-winery' },
            company: { type: ['string', 'null'] },
            country: { type: ['string', 'null'] },
            language: { type: ['string', 'null'] },
            status: {
              type: 'string',
              enum: ['new', 'contacted', 'replied', 'interested', 'not_interested', 'call_scheduled', 'closed'],
            },
            score: { type: 'number', minimum: 0, maximum: 100 },
            source: { type: ['string', 'null'], example: 'vinitaly' },
            assigned_agent: { type: ['string', 'null'] },
            last_contact_at: { type: ['string', 'null'], format: 'date-time' },
            next_action_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'status', 'score', 'created_at', 'updated_at'],
        },
        LeadInput: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            category: { type: 'string', example: 'vinitaly-winery' },
            company: { type: 'string' },
            country: { type: 'string' },
            language: { type: 'string' },
            status: {
              type: 'string',
              enum: ['new', 'contacted', 'replied', 'interested', 'not_interested', 'call_scheduled', 'closed'],
            },
            score: { type: 'number', minimum: 0, maximum: 100 },
            source: { type: 'string', example: 'vinitaly' },
            assigned_agent: { type: 'string' },
            next_action_at: { type: 'string', format: 'date-time' },
            next_followup_at: { type: 'string', format: 'date-time' },
            action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
            task_priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            task_note: { type: 'string' },
          },
          required: ['name'],
        },
        LeadMemory: {
          type: 'object',
          properties: {
            lead_id: { type: 'string', format: 'uuid' },
            summary: { type: ['string', 'null'] },
            last_intent: {
              type: ['string', 'null'],
              enum: ['interested', 'objection', 'info', 'not_interested', 'no_response', null],
            },
            tone: {
              type: ['string', 'null'],
              enum: ['formal', 'friendly', 'direct', null],
            },
            language_detected: { type: ['string', 'null'] },
            last_updated: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: ['string', 'null'], format: 'date-time' },
          },
          required: ['lead_id'],
        },
        LeadDetail: {
          type: 'object',
          properties: {
            lead: { $ref: '#/components/schemas/Lead' },
            activities: {
              type: 'array',
              items: { $ref: '#/components/schemas/Activity' },
            },
            tasks: {
              type: 'array',
              items: { $ref: '#/components/schemas/Task' },
            },
            memory: { anyOf: [{ $ref: '#/components/schemas/LeadMemory' }, { type: 'null' }] },
          },
          required: ['lead', 'activities', 'tasks', 'memory'],
        },
        Activity: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            lead_id: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: ['email_sent', 'email_open', 'email_click', 'email_reply', 'unsubscribe', 'call', 'note'],
            },
            content: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
            created_at: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'lead_id', 'type', 'content', 'metadata', 'created_at'],
        },
        ActivityLogRequest: {
          type: 'object',
          properties: {
            lead_id: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: ['email_sent', 'email_open', 'email_click', 'email_reply', 'unsubscribe', 'call', 'note'],
            },
            content: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['lead_id', 'type', 'content'],
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            lead_id: { type: 'string', format: 'uuid' },
            action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
            due_at: { type: ['string', 'null'], format: 'date-time' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            status: { type: 'string', enum: ['pending', 'completed'] },
            note: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            type: { type: 'string' },
            idempotency_key: { type: ['string', 'null'] },
          },
          required: ['id', 'lead_id', 'action', 'priority', 'status', 'created_at', 'updated_at', 'type'],
        },
        TaskCreateRequest: {
          type: 'object',
          properties: {
            lead_id: { type: 'string', format: 'uuid' },
            action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
            type: { type: 'string', example: 'follow-up' },
            due_at: { type: 'string', format: 'date-time' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            note: { type: 'string' },
            idempotency_key: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'completed'] },
          },
          required: ['lead_id', 'due_at'],
        },
        NextActionSuggestion: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
            delay_hours: { type: 'number', minimum: 0 },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            reason: { type: ['string', 'null'] },
          },
          required: ['action', 'delay_hours', 'priority', 'reason'],
        },
        ReplyClassification: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              enum: ['interested', 'objection', 'info', 'not_interested', 'no_response'],
            },
            tone: { type: 'string', enum: ['formal', 'friendly', 'direct'] },
            language_detected: { type: 'string' },
          },
          required: ['intent', 'tone', 'language_detected'],
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid authorization',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Unauthorized' },
            },
          },
        },
        ServerError: {
          description: 'Unexpected server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Failed to process request' },
            },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          responses: {
            '200': {
              description: 'Application is alive',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                    required: ['status', 'timestamp'],
                  },
                },
              },
            },
          },
        },
      },
      '/api/leads': {
        get: {
          tags: ['Leads'],
          summary: 'List leads',
          description: 'Ritorna lead AI-ready, filtrabili per status, source e category.',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          ],
          responses: {
            '200': {
              description: 'Lead list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      leads: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Lead' },
                      },
                    },
                    required: ['leads'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
        post: {
          tags: ['Leads'],
          summary: 'Create lead',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LeadInput' },
                example: {
                  name: 'Cantina Rossi',
                  email: 'export@cantinarossi.it',
                  phone: '+39 345 0000000',
                  category: 'vinitaly-winery',
                  source: 'vinitaly',
                  status: 'new',
                  next_action_at: '2026-04-02T10:00:00.000Z',
                  action: 'call',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Lead created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      lead: { $ref: '#/components/schemas/Lead' },
                      task: { anyOf: [{ $ref: '#/components/schemas/Task' }, { type: 'null' }] },
                    },
                    required: ['lead'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/{id}': {
        get: {
          tags: ['Leads'],
          summary: 'Get lead detail',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Lead detail',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/LeadDetail' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/update': {
        post: {
          tags: ['Leads'],
          summary: 'Update lead',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/LeadInput' },
                    {
                      type: 'object',
                      properties: {
                        lead_id: { type: 'string', format: 'uuid' },
                        id: { type: 'string', format: 'uuid' },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Lead updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      lead: { $ref: '#/components/schemas/Lead' },
                    },
                    required: ['lead'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing lead id',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/{id}/status': {
        post: {
          tags: ['Leads'],
          summary: 'Update lead status',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      enum: ['new', 'contacted', 'replied', 'interested', 'not_interested', 'call_scheduled', 'closed'],
                    },
                    next_action_at: { type: 'string', format: 'date-time' },
                    next_followup_at: { type: 'string', format: 'date-time' },
                    action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
                    task_priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                    task_note: { type: 'string' },
                  },
                  required: ['status'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Status updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      lead: { $ref: '#/components/schemas/Lead' },
                    },
                    required: ['lead'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/{id}/memory': {
        get: {
          tags: ['Leads', 'AI'],
          summary: 'Get lead memory',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Memory loaded',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      memory: {
                        anyOf: [
                          { $ref: '#/components/schemas/LeadMemory' },
                          { type: 'null' },
                        ],
                      },
                    },
                    required: ['memory'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/{id}/memory/update': {
        post: {
          tags: ['Leads', 'AI'],
          summary: 'Update memory for a lead',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    new_interaction: { type: 'string' },
                  },
                  required: ['new_interaction'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Memory updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      summary: { type: 'string' },
                      tone: { type: 'string' },
                      language_detected: { type: 'string' },
                      memory: { $ref: '#/components/schemas/LeadMemory' },
                    },
                    required: ['summary', 'tone', 'language_detected', 'memory'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/leads/next-actions': {
        get: {
          tags: ['Leads', 'Tasks'],
          summary: 'Get prioritized next actions',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Prioritized leads to contact',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      leads: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            lead: { $ref: '#/components/schemas/Lead' },
                            task: { anyOf: [{ $ref: '#/components/schemas/Task' }, { type: 'null' }] },
                            due_at: { type: ['string', 'null'], format: 'date-time' },
                            action: { type: 'string', enum: ['send_email', 'call', 'wait'] },
                            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                          },
                          required: ['lead', 'due_at', 'action', 'priority'],
                        },
                      },
                    },
                    required: ['leads'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/activity/log': {
        post: {
          tags: ['Activities'],
          summary: 'Log a CRM activity/event',
          description:
            'Usa questo endpoint per registrare eventi operativi. `email_sent` crea un task di attesa; ' +
            '`email_reply` aggiorna memoria, score e next action.',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ActivityLogRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Activity logged',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      activity: { $ref: '#/components/schemas/Activity' },
                      lead: { $ref: '#/components/schemas/Lead' },
                      task: { anyOf: [{ $ref: '#/components/schemas/Task' }, { type: 'null' }] },
                      classification: { anyOf: [{ $ref: '#/components/schemas/ReplyClassification' }, { type: 'null' }] },
                      memory: { anyOf: [{ $ref: '#/components/schemas/LeadMemory' }, { type: 'null' }] },
                      next_action: { anyOf: [{ $ref: '#/components/schemas/NextActionSuggestion' }, { type: 'null' }] },
                      score: { type: ['number', 'null'] },
                    },
                    required: ['activity', 'lead', 'task', 'classification', 'memory', 'next_action', 'score'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing required data',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/tasks/pending': {
        get: {
          tags: ['Tasks'],
          summary: 'List pending tasks',
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'lead_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          ],
          responses: {
            '200': {
              description: 'Pending tasks',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tasks: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Task' },
                      },
                    },
                    required: ['tasks'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/tasks/create': {
        post: {
          tags: ['Tasks'],
          summary: 'Create a task',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TaskCreateRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Task created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      task: { $ref: '#/components/schemas/Task' },
                    },
                    required: ['task'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing lead_id or due_at',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/tasks/{id}/complete': {
        post: {
          tags: ['Tasks'],
          summary: 'Complete a task',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Task completed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      task: { $ref: '#/components/schemas/Task' },
                    },
                    required: ['task'],
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/ai/classify-reply': {
        post: {
          tags: ['AI'],
          summary: 'Classify a reply',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email_text: { type: 'string' },
                    lead_id: { type: 'string', format: 'uuid' },
                  },
                  required: ['email_text'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Reply classification',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReplyClassification' },
                },
              },
            },
            '400': {
              description: 'Missing email_text',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/ai/next-action': {
        post: {
          tags: ['AI'],
          summary: 'Compute next action',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lead_id: { type: 'string', format: 'uuid' },
                    history: { type: 'string' },
                    last_activity: { type: 'string' },
                  },
                  required: ['lead_id'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Next action suggestion',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NextActionSuggestion' },
                },
              },
            },
            '400': {
              description: 'Missing lead_id',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/ai/score-lead': {
        post: {
          tags: ['AI'],
          summary: 'Score a lead',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lead_id: { type: 'string', format: 'uuid' },
                  },
                  required: ['lead_id'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Lead score',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      score: { type: 'number', minimum: 0, maximum: 100 },
                    },
                    required: ['score'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing lead_id',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/ai/update-memory': {
        post: {
          tags: ['AI'],
          summary: 'Update lead memory',
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lead_id: { type: 'string', format: 'uuid' },
                    new_interaction: { type: 'string' },
                  },
                  required: ['lead_id', 'new_interaction'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Memory updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      summary: { type: 'string' },
                      tone: { type: 'string' },
                      language_detected: { type: 'string' },
                      memory: { $ref: '#/components/schemas/LeadMemory' },
                    },
                    required: ['summary', 'tone', 'language_detected', 'memory'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing lead_id or new_interaction',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/automation/followups': {
        post: {
          tags: ['Automation'],
          summary: 'Generate due follow-up tasks',
          security: [{ AutomationSecret: [] }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string', format: 'email' },
                    category: { type: 'string' },
                    source: { type: 'string' },
                    dry_run: { type: 'boolean' },
                  },
                },
                example: {
                  category: 'vinitaly-winery',
                  source: 'vinitaly',
                  dry_run: true,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Automation result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      category: { type: ['string', 'null'] },
                      source: { type: ['string', 'null'] },
                      dry_run: { type: 'boolean' },
                      contacts_due: { type: 'integer' },
                      created_tasks: { type: 'integer' },
                    },
                    required: ['category', 'source', 'dry_run', 'contacts_due', 'created_tasks'],
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized automation',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/automation/stale-leads': {
        post: {
          tags: ['Automation'],
          summary: 'List stale leads',
          security: [{ AutomationSecret: [] }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    stale_days: { type: 'integer', minimum: 1, default: 5 },
                    category: { type: 'string' },
                    source: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Stale lead list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      stale_days: { type: 'integer' },
                      category: { type: ['string', 'null'] },
                      source: { type: ['string', 'null'] },
                      summary_by_category: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            category: { type: 'string' },
                            count: { type: 'integer' },
                          },
                          required: ['category', 'count'],
                        },
                      },
                      stale_leads: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Lead' },
                      },
                    },
                    required: ['stale_days', 'category', 'source', 'summary_by_category', 'stale_leads'],
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized automation',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/speaqi/leads': {
        post: {
          tags: ['Inbound'],
          summary: 'Inbound Speaqi lead webhook',
          security: [{ WebhookSecret: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    phone: { type: 'string' },
                    category: { type: 'string' },
                    source: { type: 'string' },
                    priority: { type: 'number', minimum: 0, maximum: 3 },
                    responsible: { type: 'string' },
                    note: { type: 'string' },
                    next_followup_at: { type: 'string', format: 'date-time' },
                  },
                  required: ['user_id'],
                },
                example: {
                  user_id: '9fbaad92-820e-4e48-9b4a-95ebeb0c8a91',
                  name: 'Cantina Demo',
                  phone: '+39 345 1111111',
                  category: 'vinitaly-winery',
                  source: 'vinitaly',
                  priority: 2,
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Lead ingested',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      contact: { type: 'object', additionalProperties: true },
                      task: { type: 'object', additionalProperties: true },
                    },
                    required: ['contact', 'task'],
                  },
                },
              },
            },
            '400': {
              description: 'Missing user_id',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': {
              description: 'Unauthorized webhook',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
      '/api/integrations/acumbamail/webhook': {
        get: {
          tags: ['Inbound'],
          summary: 'Inspect Acumbamail webhook endpoint',
          responses: {
            '200': {
              description: 'Webhook endpoint metadata',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Inbound'],
          summary: 'Inbound Acumbamail engagement webhook',
          description:
            'Riceve eventi Acumbamail come opens, clicks e unsubscribes. ' +
            'Per installazioni multi-account puoi passare `user_id` in query string.',
          parameters: [
            {
              name: 'user_id',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'token',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        event: { type: 'string', example: 'opens' },
                        email: { type: 'string', format: 'email' },
                        timestamp: { type: 'integer', example: 1774867200 },
                      },
                      required: ['event', 'email'],
                    },
                    {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          event: { type: 'string', example: 'clicks' },
                          email: { type: 'string', format: 'email' },
                          timestamp: { type: 'integer', example: 1774867200 },
                        },
                        required: ['event', 'email'],
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook processed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
            '400': {
              description: 'No supported events found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '401': {
              description: 'Unauthorized webhook',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': { $ref: '#/components/responses/ServerError' },
          },
        },
      },
    },
  }
}
