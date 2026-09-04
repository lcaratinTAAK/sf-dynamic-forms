/**
 * Dados fixos de teste, um cenário por formulário.
 *
 * Qual conjunto aparece depende de um campo-assinatura presente no contrato
 * renderizado — não do `source` nem de qualquer id, porque o mesmo formulário
 * pode ser servido por fontes diferentes. Os valores de picklist são os API
 * values reais do Salesforce (conferidos contra o schema de `FormSpec__c` e os
 * scripts `scripts/forms/seed-*.apex` do repo `quintoandar/salesforce`), não
 * labels nem valores inventados.
 */

const temCampo = (contract, apiName) =>
  contract.sections.some((s) => s.fields.some((f) => f.apiName === apiName));

/**
 * SI Demo — Alteração de Dados Bancários (legado, ainda aponta para Case).
 * Não mexer nos valores: são os únicos usados por esse formulário mais antigo.
 */
const CENARIOS_BANCARIO_LEGADO = (() => {
  const COMUM = {
    SI_ContractStatus__c: 'Ativo',
    SI_Email__c: 'teste.demo@exemplo.com.br',
    SI_FullName__c: 'Maria Teste da Silva',
    SI_OwnerDocument__c: '000.000.000-00',

    SI_AccountHolder__c: 'MesmaTitularidade',
    SI_BankType__c: 'BancoDigital',
    SI_BankBranch__c: '0001',
    SI_BankAccount__c: '123456-7',
    SI_DocumentType__c: 'CNH',
  };

  const ANEXOS = ['documento-frente.jpg', 'documento-verso.jpg', 'selfie-documento.jpg'];

  return [
    {
      id: 'proprietario',
      label: 'Preencher como Proprietário',
      values: {
        ...COMUM,
        SI_RequesterType__c: 'Proprietario',
        SI_PPMulti__c: 'Nao',
        SI_SameAccountAllContracts__c: 'Sim',
      },
      files: ANEXOS,
    },
    {
      id: 'parceiro',
      label: 'Preencher como Parceiro',
      values: {
        ...COMUM,
        SI_RequesterType__c: 'Parceiro',
        SI_PartnerRole__c: 'Corretor',
        SI_PartnerCPF__c: '111.111.111-11',
        SI_PartnerPhone__c: '(11) 90000-0000',
      },
      files: ANEXOS,
    },
  ];
})();

/**
 * `bank_data_change_full` — FormDefinition__c -> FormSpec__c, 43 campos do
 * Cognito 335. Seis anexos SEMPRE contam no agregado de obrigatórios
 * (`contract.attachments.minimumCount` soma todos os componentes com
 * `IsRequired__c`, sem filtrar por visibilidade), por isso os dois cenários
 * trazem os 6 códigos — mesmo quando os 3 do titular ficam ocultos porque a
 * titularidade escolhida foi "Mesma titularidade" ou porque o solicitante é
 * Parceiro (a doc do titular nunca fica condicionada ao solicitante).
 */
const ANEXOS_BANCARIO_COMPLETO = [
  { name: 'doc-proprietario-frente.jpg', size: 204800, __code: 'DOC_OWNER_FRONT' },
  { name: 'doc-proprietario-verso.jpg', size: 204800, __code: 'DOC_OWNER_BACK' },
  { name: 'selfie-proprietario.jpg', size: 204800, __code: 'SELFIE_OWNER' },
  { name: 'doc-titular-frente.jpg', size: 204800, __code: 'DOC_HOLDER_FRONT' },
  { name: 'doc-titular-verso.jpg', size: 204800, __code: 'DOC_HOLDER_BACK' },
  { name: 'selfie-titular.jpg', size: 204800, __code: 'SELFIE_HOLDER' },
];

const CENARIOS_BANCARIO_COMPLETO = [
  {
    id: 'proprietario',
    label: 'Preencher como Proprietário',
    values: {
      RequesterType__c: 'Proprietário',
      IsPPMulti__c: 'Não',
      ContractStatus__c: 'Ativo',
      RegisteredEmail__c: 'teste.proprietario@exemplo.com.br',
      FullName__c: 'Maria Teste da Silva',
      OwnerDocument__c: '12345678900',
      ContractNumber__c: 'CTR-000123',
      SameAccountAllContracts__c: 'Sim',
      ReceivedLastRentPayment__c: 'Sim',
      AccountHolderRelation__c: 'Mesma titularidade',
      AccountHolderDocumentType__c: 'CPF',
      AccountHolderCPF__c: '12345678900',
      AccountHolderName__c: 'Maria Teste da Silva',
      BankType__c: 'Banco Digital',
      DigitalBankName__c: 'Nubank (260)',
      BankBranch__c: '0001',
      BankBranchDigit__c: '1',
      BankAccount__c: '123456-7',
      BankAccountDigit__c: '7',
      BankAccountType__c: 'Conta Corrente Individual',
      DocumentType__c: 'CNH',
      ConfirmedGoodLighting__c: true,
      ConfirmedNoAccessories__c: true,
      ConfirmedPhotosReadable__c: true,
      ConfirmedSamePersonAsDocument__c: true,
    },
    files: ANEXOS_BANCARIO_COMPLETO,
  },
  {
    id: 'parceiro',
    label: 'Preencher como Parceiro',
    values: {
      RequesterType__c: 'Parceiro',
      PartnerRole__c: 'Corretor',
      PartnerCPF__c: '11111111111',
      PartnerPhone__c: '11900000000',
      RegisteredEmail__c: 'teste.parceiro@exemplo.com.br',
      FullName__c: 'João Teste Corretor',
      // Documento do titular da conta não é condicionado ao solicitante —
      // segue pedido mesmo quando quem preenche é o Parceiro.
      AccountHolderDocumentType__c: 'CPF',
      AccountHolderCPF__c: '22222222222',
      AccountHolderName__c: 'Nome do Titular da Conta',
      BankType__c: 'Banco Físico',
      PhysicalBankName__c: 'Banco do Brasil ( 001 )',
      BankBranch__c: '1234',
      BankBranchDigit__c: '5',
      BankAccount__c: '654321-0',
      BankAccountDigit__c: '0',
      BankAccountType__c: 'Conta Poupança',
      DocumentType__c: 'RG',
      ConfirmedGoodLighting__c: true,
      ConfirmedNoAccessories__c: true,
      ConfirmedPhotosReadable__c: true,
      ConfirmedSamePersonAsDocument__c: true,
    },
    files: ANEXOS_BANCARIO_COMPLETO,
  },
];

/**
 * `consumption_account_adjustment` — espelha a Page Layout do MagicLink
 * (Case, Record Type ConsumptionAccountAdjustment), sem regra condicional
 * nenhuma na definição. Um cenário só cobre o formulário inteiro.
 */
const CENARIOS_AJUSTE_CONTA_CONSUMO = [
  {
    id: 'padrao',
    label: 'Preencher cenário padrão',
    values: {
      Type__c: 'NoServiceInterruption',
      Origin__c: 'MagicLink',
      SuppliedEmail__c: 'teste.demo@exemplo.com.br',
      ClientPhone__c: '11900000000',
      PropertyID__c: 'IMV-0001',
      ServiceAccountIssue__c: 'Débitos Pendentes anteriores a locação',
      ClientType__c: 'Proprietário',
      WhoIssuesTheBill__c: 'Concessionária (Enel, Light, Sabesp, Cemig, etc)',
      CaseDescription__c: 'Ajuste de conta de consumo referente ao período de transição do contrato.',
      PPMultiPicklist__c: 'Não',
      RelatedContractId__c: 'CTR-000123',
      PreferredContactChannel__c: 'WhatsApp',
      IsItMoreThanOneBill__c: 'Uma conta',
      AccountType__c: 'Energia',
      AccountValue__c: '250.00',
      Status__c: 'Novo',
    },
    files: [],
  },
];

const FORM_SCENARIOS = [
  {
    matches: (c) => temCampo(c, 'SI_RequesterType__c'),
    scenarios: CENARIOS_BANCARIO_LEGADO,
  },
  {
    matches: (c) => temCampo(c, 'BankType__c') && temCampo(c, 'PartnerCPF__c'),
    scenarios: CENARIOS_BANCARIO_COMPLETO,
  },
  {
    matches: (c) => temCampo(c, 'ServiceAccountIssue__c') && temCampo(c, 'WhoIssuesTheBill__c'),
    scenarios: CENARIOS_AJUSTE_CONTA_CONSUMO,
  },
];

/** O botão só faz sentido no formulário que tem um cenário cadastrado. */
export function suportaDemo(contract) {
  return FORM_SCENARIOS.some((fs) => fs.matches(contract));
}

export function cenariosPara(contract) {
  return FORM_SCENARIOS.find((fs) => fs.matches(contract))?.scenarios ?? [];
}
