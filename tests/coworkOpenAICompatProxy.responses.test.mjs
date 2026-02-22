import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 导入 OpenAI 兼容代理模块
const proxyModule = require('../dist-electron/libs/coworkOpenAICompatProxy.js');
// 获取测试工具函数
const testUtils = proxyModule.__openAICompatProxyTestUtils;

if (!testUtils) {
  throw new Error('__openAICompatProxyTestUtils 不可用');
}

/**
 * 创建模拟响应对象
 * 用于测试中捕获输出数据
 */
function createMockResponse() {
  let output = '';
  return {
    // 写入数据块到输出缓冲区
    write(chunk) {
      output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      return true;
    },
    // 获取累积的输出内容
    getOutput() {
      return output;
    },
  };
}

/**
 * 解析 SSE（Server-Sent Events）事件
 * 将原始 SSE 格式字符串解析为事件对象数组
 * @param {string} raw - 原始 SSE 格式字符串
 * @returns {Array} 解析后的事件对象数组
 */
function parseSSEEvents(raw) {
  // 按双换行符分割数据包
  const packets = raw.split('\n\n').filter(Boolean);
  const events = [];

  for (const packet of packets) {
    const lines = packet.split(/\r?\n/);
    let eventName = '';
    const dataLines = [];

    // 解析每一行，提取事件名称和数据
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trimStart();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    // 合并数据行
    const dataRaw = dataLines.join('\n');
    // 跳过空数据或结束标记
    if (!dataRaw || dataRaw === '[DONE]') {
      continue;
    }

    // 尝试解析 JSON 数据
    let dataParsed = dataRaw;
    try {
      dataParsed = JSON.parse(dataRaw);
    } catch {
      // 解析失败时保留原始字符串
    }

    events.push({
      event: eventName,
      data: dataParsed,
    });
  }

  return events;
}

/**
 * 收集输入 JSON 增量数据
 * 从事件列表中提取所有 input_json_delta 类型的数据
 * @param {Array} events - 事件对象数组
 * @returns {Array<string>} 输入 JSON 增量字符串数组
 */
function collectInputJsonDeltas(events) {
  return events
    .filter((event) => event.event === 'content_block_delta')
    .map((event) => event.data)
    .filter((data) => data?.delta?.type === 'input_json_delta')
    .map((data) => String(data.delta.partial_json ?? ''));
}

/**
 * 收集工具使用开始事件
 * 从事件列表中提取所有 tool_use 类型的内容块开始事件
 * @param {Array} events - 事件对象数组
 * @returns {Array<Object>} 工具使用对象数组，包含 id 和 name
 */
function collectToolUseStarts(events) {
  return events
    .filter((event) => event.event === 'content_block_start')
    .map((event) => event.data)
    .filter((data) => data?.content_block?.type === 'tool_use')
    .map((data) => ({
      id: String(data.content_block.id ?? ''),
      name: String(data.content_block.name ?? ''),
    }));
}

/**
 * 运行响应序列
 * 按顺序处理事件序列并返回解析后的事件结果
 * @param {Array} sequence - 事件序列数组
 * @returns {Object} 包含事件、输入 JSON 增量和工具使用开始信息的结果对象
 */
function runResponsesSequence(sequence) {
  const response = createMockResponse();
  const state = testUtils.createStreamState();
  const context = testUtils.createResponsesStreamContext();

  // 按顺序处理每个事件步骤
  for (const step of sequence) {
    testUtils.processResponsesStreamEvent(
      response,
      state,
      context,
      step.event,
      step.payload
    );
  }

  const events = parseSSEEvents(response.getOutput());
  return {
    events,
    inputJsonDeltas: collectInputJsonDeltas(events),
    toolUseStarts: collectToolUseStarts(events),
  };
}

test('A: added -> delta* -> done 仅发出一个最终的参数载荷', () => {
  const responseId = 'resp_a';
  const model = 'gpt-5.2';
  const finalArguments = '{"questions":[{"header":"安全确认","question":"继续?","options":[{"label":"允许","description":"ok"},{"label":"拒绝","description":"no"}]}],"answers":{}}';

  const result = runResponsesSequence([
    {
      event: 'response.output_item.added',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_a',
          call_id: 'call_a',
          name: 'AskUserQuestion',
        },
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_a',
        delta: '{"questions":[{"header":"安全确认",',
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_a',
        delta: '"question":"继续?"}]}',
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_a',
        arguments: finalArguments,
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_a',
              call_id: 'call_a',
              output_index: 0,
              name: 'AskUserQuestion',
              arguments: finalArguments,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 1);
  assert.equal(result.inputJsonDeltas[0], finalArguments);
});

test('B: output_item.done 携带 item.arguments 时无需 function_call_arguments 事件即可工作', () => {
  const responseId = 'resp_b';
  const model = 'gpt-5.2';
  const finalArguments = '{"skill":"web-search"}';

  const result = runResponsesSequence([
    {
      event: 'response.output_item.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_b',
          call_id: 'call_b',
          name: 'Skill',
          arguments: finalArguments,
        },
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_b',
              call_id: 'call_b',
              output_index: 0,
              name: 'Skill',
              arguments: finalArguments,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 1);
  assert.equal(result.inputJsonDeltas[0], finalArguments);
});

test('C: delta 在 added 之前时保持正确的 name/id 且不丢失参数', () => {
  const responseId = 'resp_c';
  const model = 'gpt-5.2';
  const finalArguments = '{"skill":"web-search"}';

  const result = runResponsesSequence([
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        call_id: 'call_c',
        output_index: 0,
        delta: '{"skill":"web-search"}',
      },
    },
    {
      event: 'response.output_item.added',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_c',
          call_id: 'call_c',
          name: 'Skill',
        },
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        call_id: 'call_c',
        output_index: 0,
        arguments: finalArguments,
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_c',
              call_id: 'call_c',
              output_index: 0,
              name: 'Skill',
              arguments: finalArguments,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 1);
  assert.equal(result.inputJsonDeltas[0], finalArguments);
  assert.ok(result.toolUseStarts.some((item) => item.name === 'Skill'));
});

test('D: output_item.done + function_call_arguments.done 仅发出一次参数', () => {
  const responseId = 'resp_d';
  const model = 'gpt-5.2';
  const finalArguments = '{"questions":[{"question":"Q","options":[{"label":"Y"}]}]}';

  const result = runResponsesSequence([
    {
      event: 'response.output_item.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_d',
          call_id: 'call_d',
          name: 'AskUserQuestion',
          arguments: finalArguments,
        },
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_d',
        arguments: finalArguments,
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_d',
              call_id: 'call_d',
              output_index: 0,
              name: 'AskUserQuestion',
              arguments: finalArguments,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 1);
  assert.equal(result.inputJsonDeltas[0], finalArguments);
});

test('E: 混合 item_id/call_id 映射不会导致调用重复或错配', () => {
  const responseId = 'resp_e';
  const model = 'gpt-5.2';
  const finalArguments = '{"command":"rm -rf build"}';

  const result = runResponsesSequence([
    {
      event: 'response.output_item.added',
      payload: {
        response_id: responseId,
        model,
        output_index: 2,
        item: {
          type: 'function_call',
          id: 'fc_e',
          name: 'Bash',
        },
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 2,
        item_id: 'fc_e',
        delta: '{"command":"rm -rf ',
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 2,
        item_id: 'fc_e',
        call_id: 'call_e',
        arguments: finalArguments,
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_e',
              call_id: 'call_e',
              output_index: 2,
              name: 'Bash',
              arguments: finalArguments,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 1);
  assert.equal(result.inputJsonDeltas[0], finalArguments);
});

test('F: 两个交错函数调用保持参数隔离', () => {
  const responseId = 'resp_f';
  const model = 'gpt-5.2';
  const args1 = '{"skill":"web-search"}';
  const args2 = '{"questions":[{"question":"Q","options":[{"label":"Y"}]}]}';

  const result = runResponsesSequence([
    {
      event: 'response.output_item.added',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_f1',
          call_id: 'call_f1',
          name: 'Skill',
        },
      },
    },
    {
      event: 'response.output_item.added',
      payload: {
        response_id: responseId,
        model,
        output_index: 1,
        item: {
          type: 'function_call',
          id: 'fc_f2',
          call_id: 'call_f2',
          name: 'AskUserQuestion',
        },
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_f1',
        delta: '{"skill":"',
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 1,
        call_id: 'call_f2',
        delta: '{"questions":[{"question":"Q","options":[{"label":"Y"}]}]}',
      },
    },
    {
      event: 'response.function_call_arguments.delta',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_f1',
        delta: 'web-search"}',
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 1,
        call_id: 'call_f2',
        arguments: args2,
      },
    },
    {
      event: 'response.function_call_arguments.done',
      payload: {
        response_id: responseId,
        model,
        output_index: 0,
        call_id: 'call_f1',
        arguments: args1,
      },
    },
    {
      event: 'response.completed',
      payload: {
        response: {
          id: responseId,
          model,
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_f1',
              call_id: 'call_f1',
              output_index: 0,
              name: 'Skill',
              arguments: args1,
            },
            {
              type: 'function_call',
              id: 'fc_f2',
              call_id: 'call_f2',
              output_index: 1,
              name: 'AskUserQuestion',
              arguments: args2,
            },
          ],
        },
      },
    },
  ]);

  assert.equal(result.inputJsonDeltas.length, 2);
  assert.equal(result.inputJsonDeltas.filter((item) => item === args1).length, 1);
  assert.equal(result.inputJsonDeltas.filter((item) => item === args2).length, 1);
});

test('G: convertChatCompletionsRequestToResponsesRequest 自动注入缺失的 function_call_output', () => {
  const request = testUtils.convertChatCompletionsRequestToResponsesRequest({
    model: 'gpt-5.2',
    stream: true,
    messages: [
      { role: 'user', content: 'make ppt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_missing_output',
            type: 'function',
            function: {
              name: 'Skill',
              arguments: '{"skill":"pptx"}',
            },
          },
        ],
      },
    ],
  });

  const input = Array.isArray(request.input) ? request.input : [];
  const autoInjected = input.find((item) => (
    item?.type === 'function_call_output'
    && item?.call_id === 'call_missing_output'
  ));

  assert.ok(autoInjected, '期望代理自动注入 function_call_output');
  assert.equal(typeof autoInjected.output, 'string');
});

test('H: filterOpenAIToolsForProvider 移除 Skill 工具并规范化 tool_choice', () => {
  const openAIRequest = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'Skill',
          parameters: {
            type: 'object',
            properties: {
              skill: { type: 'string' },
            },
            required: ['skill'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'Bash',
          parameters: { type: 'object' },
        },
      },
    ],
    tool_choice: {
      type: 'function',
      function: {
        name: 'Skill',
      },
    },
  };

  testUtils.filterOpenAIToolsForProvider(openAIRequest, 'openai');

  assert.equal(openAIRequest.tools.length, 1);
  assert.equal(openAIRequest.tools[0].function.name, 'Bash');
  assert.equal(openAIRequest.tool_choice, 'auto');
});
