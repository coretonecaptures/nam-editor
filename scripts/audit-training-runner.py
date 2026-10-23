"""Regression checks for the embedded trainer runner (docs/training-audit.md #12, #13).

Extracts functions from the runner source embedded in src/main/index.ts; no NAM/PyTorch imports
and no training. Writes only to a temporary directory that is removed afterwards.

Run: python scripts/audit-training-runner.py
"""
import ast
import os
import tempfile
import time
from pathlib import Path

source = (Path(__file__).resolve().parent.parent / 'src/main/index.ts').read_text(encoding='utf8')
runner = source.split('const TRAINER_RUNNER_SOURCE = String.raw`', 1)[1].split('`', 1)[0]
tree = ast.parse(runner)


def extract(names, namespace):
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert len(nodes) == len(names), f'missing one of {names}'
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<embedded-runner>', 'exec'), namespace)
    return namespace


# #12 — intended: A2 trains from NAM's own packed config. Stock neural-amp-modeler 0.13.0's train()
# takes no lr/lr_decay/fit_mrstft, and every NAM Lab builder fills A1 defaults into the payload, so
# the runner must NOT forward them (see the _run_a2 docstring).
calls = []
ns = extract(['_run_a2'], {'train': lambda **kwargs: calls.append(kwargs)})
ns['_build_user_metadata'] = lambda _: None
payload = dict(inputPath='in.wav', outputPath='out.wav', trainPath='workspace', epochs=10, modelName='Model')
ns['_run_a2']({**payload, 'lr': 0.001, 'lrDecay': 0.01, 'fitMrstft': False})
ns['_run_a2']({**payload, 'lr': 0.1, 'lrDecay': 0.2, 'fitMrstft': True})
assert calls[0] == calls[1]
assert not {'lr', 'lr_decay', 'fit_mrstft'} & set(calls[0])
print('OK #12: A2 keeps NAM\'s packed optimizer config (payload LR settings not forwarded)')

# #13 — a retry reuses its workspace; a .nam left by an earlier attempt must not beat this
# attempt's fresh export.
with tempfile.TemporaryDirectory() as tmp:
    workspace = Path(tmp)
    stale = workspace / 'Model.nam'
    stale.write_text('{}')
    an_hour_ago = time.time() - 3600
    os.utime(stale, (an_hour_ago, an_hour_ago))

    ns = extract(['_is_fresh', '_find_output_model_path'],
                 {'Path': Path, '_RUN_STARTED_AT': time.time(), '_MTIME_SLACK_S': 2.0})
    exported = workspace / 'exported'
    exported.mkdir()
    fresh = exported / 'Model_checkpoint_best.nam'
    fresh.write_text('{}')
    assert Path(ns['_find_output_model_path'](str(workspace), 'Model')) == fresh
    print('OK #13: a fresh export wins over a retained Model.nam from an earlier attempt')

    fresh.unlink()
    # Nothing fresh at all: the finder falls back to the expected path, and the promoter must
    # refuse it rather than report the earlier attempt's model as this run's result.
    ns = extract(['_is_fresh', '_find_output_model_path', '_promote_output_model_path'],
                 {'Path': Path, '_RUN_STARTED_AT': time.time(), '_MTIME_SLACK_S': 2.0})
    found = ns['_find_output_model_path'](str(workspace), 'Model')
    try:
        ns['_promote_output_model_path'](str(workspace), 'Model', found)
        raise AssertionError('stale model was promoted')
    except FileNotFoundError:
        pass
    print('OK #13: with no fresh output, the stale model is refused rather than promoted')

print('Runner regression checks passed. No training performed.')
