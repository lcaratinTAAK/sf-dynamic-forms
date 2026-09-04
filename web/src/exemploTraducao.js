/**
 * O exemplo do tradutor da página "Solução Custom".
 *
 * É um formulário INVENTADO, pequeno de propósito, mas com a forma exata do que
 * o Salesforce devolve: as chaves, o aninhamento de `RecordType.DeveloperName`,
 * o `attributes` que vem em toda linha de SOQL. Cabe na tela e ainda assim
 * exercita um de cada componente e um de cada tipo de regra.
 *
 * Quem for reimplementar o adaptador pode colar o retorno real da própria org
 * aqui e comparar a saída — a rota `/api/traduzir` roda o MESMO código do
 * adaptador, não uma cópia.
 */

const attrs = (tipo, id) => ({
  type: tipo,
  url: `/services/data/v66.0/sobjects/${tipo}/${id}`,
});

/** Linha de FormDefinition__c com os defaults que o objeto sempre devolve. */
const linha = (id, rt, campos) => ({
  attributes: attrs('FormDefinition__c', id),
  Id: id,
  RecordType: { attributes: attrs('RecordType', '012xx'), DeveloperName: rt },
  Form__c: id === 'a0xFORM' ? null : 'a0xFORM',
  Parent__c: null,
  Sort__c: 0,
  Width__c: 'FULL',
  IsHidden__c: false,
  IsRequired__c: false,
  IsReadOnly__c: false,
  Effect__c: 'SHOW',
  Operator__c: 'EQUALS',
  FilterLogicType__c: 'ALL',
  RequiredLogicType__c: 'ALL',
  ValidationLogicType__c: 'ALL',
  ValueSource__c: 'LITERAL',
  ...campos,
});

/** EntityParticle: o metadado do campo. Vem da chamada 01. */
const particula = (api, label, tipo, extras = {}) => ({
  attributes: attrs('EntityParticle', api),
  QualifiedApiName: api,
  Label: label,
  DataType: tipo,
  Length: extras.Length ?? null,
  IsNillable: extras.IsNillable ?? true,
  IsCreatable: true,
  IsUpdatable: true,
  IsCalculated: false,
  InlineHelpText: extras.InlineHelpText ?? null,
  IsDependentPicklist: extras.IsDependentPicklist ?? false,
  DurableId: extras.DurableId ?? `Case.${api}`,
});

export const EXEMPLO = {
  formId: 'a0xFORM',

  // ─── chamada 03: Record Type de destino ────────────────────────────────────
  recordType: { Id: '012DEMO', Name: 'Alteração de Dados Bancários' },

  // ─── chamada 01, subrequisição 1: EntityParticle ──────────────────────────
  schema: [
    particula('SI_RequesterType__c', 'Selecione o seu usuário', 'picklist'),
    particula('SI_Email__c', 'E-mail cadastrado', 'email', { Length: 80 }),
    particula('SI_PartnerCPF__c', 'CPF do parceiro', 'string', {
      Length: 14,
      InlineHelpText: 'Caso o dígito seja X, inserir 0 no lugar.',
    }),
    particula('SI_BankType__c', 'Tipo de banco', 'picklist', {
      IsDependentPicklist: true,
    }),
    particula('EffectiveDate__c', 'A partir de quando vale', 'date'),
  ],

  // ─── chamada 01, subrequisição 2: FieldDefinition ─────────────────────────
  // Quem controla quem. Sem isto o formulário não sabe qual campo observar para
  // filtrar as opções de uma picklist dependente.
  dependentes: [
    {
      attributes: attrs('FieldDefinition', 'SI_BankType__c'),
      DurableId: 'Case.SI_BankType__c',
      QualifiedApiName: 'SI_BankType__c',
      ControllingFieldDefinitionId: 'Case.SI_RequesterType__c',
    },
  ],

  // ─── chamada 04: ui-api/picklist-values ───────────────────────────────────
  picklists: {
    picklistFieldValues: {
      SI_RequesterType__c: {
        controllerValues: {},
        values: [
          { value: 'Proprietario', label: 'Proprietário', validFor: [] },
          { value: 'Parceiro', label: 'Parceiro', validFor: [] },
        ],
      },
      SI_BankType__c: {
        controllerValues: { Proprietario: 0, Parceiro: 1 },
        values: [
          { value: 'BancoDigital', label: 'Banco digital', validFor: [0, 1] },
          { value: 'BancoFisico', label: 'Banco físico', validFor: [0] },
        ],
      },
    },
  },

  // ─── chamada 02: a especificação inteira, uma SOQL ────────────────────────
  spec: [
    linha('a0xFORM', 'Form', {
      Name: 'Alteração de dados bancários',
      PublicLabel__c: 'Alteração de dados bancários',
      Description__c: 'Use este formulário para alterar a conta que recebe os repasses.',
      ObjectApiName__c: 'FormSpec__c',
      TargetRecordTypeDevName__c: 'SI_Demo_BankDataChange',
      TypeFieldApiName__c: 'Type__c',
      TypeValue__c: 'BankDataChange',
      PriorityFieldApiName__c: 'Priority__c',
      PriorityValue__c: 'Medium',
      Channel__c: 'ONLINE',
    }),

    linha('a0xSEC1', 'Section', { Name: 'Identificação', Sort__c: 1 }),
    linha('a0xF1', 'Field', {
      Name: 'Solicitante',
      Parent__c: 'a0xSEC1',
      Sort__c: 1,
      FieldApiName__c: 'SI_RequesterType__c',
      IsRequired__c: true,
    }),
    linha('a0xF2', 'Field', {
      Name: 'E-mail',
      Parent__c: 'a0xSEC1',
      Sort__c: 2,
      FieldApiName__c: 'SI_Email__c',
      IsRequired__c: true,
      Width__c: 'HALF',
    }),

    // Seção condicional: só aparece para Parceiro.
    linha('a0xSEC2', 'Section', { Name: 'Dados do parceiro', Sort__c: 2 }),
    linha('a0xR1', 'Rule', {
      Name: 'Só para parceiro',
      Parent__c: 'a0xSEC2',
      Sort__c: 1,
      ConditionFieldApiName__c: 'SI_RequesterType__c',
      Operator__c: 'EQUALS',
      Value__c: 'Parceiro',
      Effect__c: 'SHOW',
    }),
    linha('a0xF3', 'Field', {
      Name: 'CPF do parceiro',
      Parent__c: 'a0xSEC2',
      Sort__c: 1,
      FieldApiName__c: 'SI_PartnerCPF__c',
      Width__c: 'HALF',
    }),
    // Obrigatoriedade condicional: o campo existe sempre, mas só é exigido
    // quando a condição bate. Efeito REQUIRE, grupo e lógica próprios.
    linha('a0xR2', 'Rule', {
      Name: 'Exigir quando parceiro',
      Parent__c: 'a0xF3',
      Sort__c: 1,
      ConditionFieldApiName__c: 'SI_RequesterType__c',
      Operator__c: 'EQUALS',
      Value__c: 'Parceiro',
      Effect__c: 'REQUIRE',
    }),

    linha('a0xSEC3', 'Section', { Name: 'Nova conta', Sort__c: 4 }),
    linha('a0xC1', 'Content', {
      Name: 'Aviso de prazo',
      Parent__c: 'a0xSEC3',
      Sort__c: 1,
      Body__c: '<p><em>A alteração é analisada em até 2 dias úteis.</em></p>',
    }),
    linha('a0xF6', 'Field', {
      Name: 'Tipo de banco',
      Parent__c: 'a0xSEC3',
      Sort__c: 2,
      FieldApiName__c: 'SI_BankType__c',
      IsRequired__c: true,
      Width__c: 'HALF',
    }),
    linha('a0xF7', 'Field', {
      Name: 'Vigência',
      Parent__c: 'a0xSEC3',
      Sort__c: 3,
      FieldApiName__c: 'EffectiveDate__c',
      Width__c: 'HALF',
      HelpTextOverride__c: 'Precisa estar entre hoje e daqui a 30 dias.',
      Message__c: 'A data precisa estar entre hoje e daqui a 30 dias.',
      ValidationLogicType__c: 'ANY',
    }),
    // Validação: a condição descreve quando está INVÁLIDO. Duas condições em
    // ANY — antes de hoje OU depois do limite. TOKEN resolve a data relativa.
    linha('a0xR3', 'Rule', {
      Name: 'Antes de hoje',
      Parent__c: 'a0xF7',
      Sort__c: 1,
      ConditionFieldApiName__c: 'EffectiveDate__c',
      Operator__c: 'LESS_THAN',
      Value__c: 'HOJE',
      ValueSource__c: 'TOKEN',
      Effect__c: 'BLOCK',
    }),
    linha('a0xR4', 'Rule', {
      Name: 'Depois do limite',
      Parent__c: 'a0xF7',
      Sort__c: 2,
      ConditionFieldApiName__c: 'EffectiveDate__c',
      Operator__c: 'GREATER_THAN',
      Value__c: 'HOJE+30',
      ValueSource__c: 'TOKEN',
      Effect__c: 'BLOCK',
    }),

    linha('a0xSEC4', 'Section', { Name: 'Documentos', Sort__c: 5 }),
    linha('a0xA1', 'Attachment', {
      Name: 'Documento oficial com foto',
      Parent__c: 'a0xSEC4',
      Sort__c: 1,
      DocumentCode__c: 'DOC_FOTO',
      IsRequired__c: true,
      AcceptedTypes__c: 'pdf, jpg, png',
      MinFiles__c: 1,
      MaxFiles__c: 2,
      MaxSizeMb__c: 25,
    }),
  ],
};

export const EXEMPLO_JSON = JSON.stringify(EXEMPLO, null, 2);
